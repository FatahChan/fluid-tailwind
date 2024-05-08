import plugin from 'tailwindcss/plugin'
type Plugin = ReturnType<typeof plugin>
import { corePlugins } from 'tailwindcss-priv/lib/corePlugins'
import type {
	CSSRuleObject,
	KeyValuePair,
	PluginAPI,
	ResolvableTo,
	ThemeConfig
} from 'tailwindcss/types/config'
import defaultTheme from 'tailwindcss/defaultTheme'
import mapObject, { mapObjectSkip } from 'map-obj'
import { includeKeys } from 'filter-obj'
import * as log from './util/log'
import getContext, {
	type Context,
	type PluginOptions,
	type ResolvedFluidThemeConfig
} from './util/context'
import { Length, type RawValue } from './util/css'
import * as expr from './util/expr'
import { addVariant, addVariantWithModifier, matchVariant } from './util/tailwind'
import { tuple } from './util/set'
import { FluidError } from './util/errors'

export type FluidThemeConfig = ResolvableTo<ResolvedFluidThemeConfig>

type MatchUtilOrComp = PluginAPI['matchUtilities'] | PluginAPI['matchComponents']
type FilterFn = (
	utilityOrComponentNames: string[],
	options: Parameters<MatchUtilOrComp>[1]
) => boolean | null | undefined

const handle = (e: unknown, source: string) => {
	if (e instanceof FluidError) {
		log.warn(source, e.message)
	} else throw e
}

/**
 * Return a modified PluginAPI that intercepts calls to matchUtilities and matchComponents
 * to add fluidized versions of each
 */
function getFluidAPI(
	api: PluginAPI,
	context: Context,
	{ filter }: { filter?: FilterFn } = {}
): PluginAPI {
	const addFluid =
		(orig: MatchUtilOrComp): MatchUtilOrComp =>
		(utilities, options) => {
			// Skip ones with types that don't include length or any
			if (options?.type && !options.type.includes('length') && !options.type.includes('any')) return
			// Skip filtered out ones
			if (filter && !filter(Object.keys(utilities), options)) return

			// Add fluid version
			// Start by filtering the values to only valid lengths
			const values = includeKeys(options?.values ?? {}, (_, v) =>
				Boolean(Length.parse(v))
			) as KeyValuePair<string, RawValue>

			// Tailwind doesn't use the DEFAULT convention for modifiers so we'll extract it:
			const { DEFAULT, ...modifiers } = values

			Object.entries(utilities).forEach(([util, origFn]) => {
				orig(
					{
						[`~${util}`](start, { modifier: end }) {
							// See note about default modifiers above
							if (end === null && DEFAULT) end = DEFAULT

							try {
								const clamp = expr.generate(start, end, context)
								return origFn(clamp, { modifier: null }) // don't pass along the modifier
							} catch (e) {
								handle(e, `~${util}`)
								return null
							}
						}
					},
					{
						...options,
						values,
						supportsNegativeValues: false, // b/c Tailwind only negates the value, not the modifier
						modifiers
					}
				)
			})
		}

	const noop = () => {}
	return {
		...api,
		addUtilities: noop,
		addComponents: noop,
		addVariant: noop,
		addBase: noop,
		matchVariant: noop,
		// @ts-expect-error undocumented API used in corePlugins
		addDefaults: noop,
		matchUtilities: addFluid(api.matchUtilities),
		matchComponents: addFluid(api.matchComponents)
	}
}

let inFluidPlugin = false
const fluid = plugin.withOptions((options: PluginOptions = {}) => (api: PluginAPI) => {
	if (inFluidPlugin) return // prevent recursion when adding fluid versions of config.plugins
	inFluidPlugin = true

	const { theme, config, corePlugins: corePluginEnabled, matchUtilities } = api
	const context = getContext(theme, options)
	const { screens, containers } = context

	// Add fluid versions for enabled core plugins
	const fluidCoreAPI = getFluidAPI(api, context, {
		// Filter out fontSize plugin
		filter: (utils, options) => !utils.includes('text') || !options?.type?.includes('length')
	})
	Object.entries(corePlugins).forEach(([name, corePlugin]) => {
		if (!corePluginEnabled(name)) return
		corePlugin(fluidCoreAPI)
	})

	// Add fluid versions of external plugins
	const fluidPluginAPI = getFluidAPI(api, context)
	const plugins = config('plugins') as (Function | Plugin)[]
	plugins.forEach((_plugin, i) => {
		if (typeof _plugin === 'function') {
			// It's a plugin.withOptions, but wasn't passed options so try executing it
			// with no arguments:
			try {
				const plugin = _plugin() as Plugin
				plugin.handler(fluidPluginAPI)
			} catch (e) {
				log.warn('fluid-tailwind', `Could not add fluid version of \`plugins[${i}]\``)
			}
		} else {
			_plugin.handler(fluidPluginAPI)
		}
	})

	// Add new fluid text utility to handle potentially complex theme values
	// ---

	type Values<Type> = Type extends KeyValuePair<any, infer Item> ? Item : never
	type FontSize = Values<ThemeConfig['fontSize']>

	// The only thing we can really filter out is if the font size itself
	// isn't a parseable length
	const fontSizeValues = mapObject(
		(theme('fontSize') ?? {}) as KeyValuePair<string, FontSize>,
		(k, v) => {
			const [fontSize] = Array.isArray(v) ? v : [v]
			return Length.parse(fontSize) ? [k, v] : mapObjectSkip
		}
	)

	type NormalizedFontSize = {
		fontSize?: string
		lineHeight?: string
		fontWeight?: string | number
		letterSpacing?: string
	}
	const normalize = (fontSize: FontSize | null): NormalizedFontSize => {
		if (typeof fontSize === 'string') return { fontSize }
		else if (Array.isArray(fontSize))
			return typeof fontSize[1] === 'string'
				? {
						fontSize: fontSize[0],
						lineHeight: fontSize[1]
					}
				: {
						fontSize: fontSize[0],
						...fontSize[1]
					}
		return {}
	}

	// See note about default modifiers in `getFluidAPI`
	const { DEFAULT, ...fontSizeModifiers } = fontSizeValues
	matchUtilities(
		{
			'~text'(_from, { modifier: _to }) {
				if (_to === null && DEFAULT) _to = DEFAULT

				const from = normalize(_from)
				const to = normalize(_to)

				const rules: CSSRuleObject = {}

				// Font size
				try {
					rules['font-size'] = expr.generate(from.fontSize, to.fontSize, context, {
						type: true
					})
				} catch (e) {
					handle(e, '~text: Font size')
				}

				// Line height. Make sure to use double equals to catch nulls and strings <-> numbers
				if (from.lineHeight == to.lineHeight) {
					rules['line-height'] = from.lineHeight ?? null
				} else {
					try {
						rules['line-height'] = expr.generate(from.lineHeight, to.lineHeight, context)
					} catch (e) {
						handle(e, '~text: Line height')
					}
				}

				// Letter spacing. Make sure to use double equals to catch nulls and strings <-> numbers
				if (from.letterSpacing == to.letterSpacing) {
					rules['letter-spacing'] = from.letterSpacing ?? null
				} else {
					try {
						rules['letter-spacing'] = expr.generate(from.letterSpacing, to.letterSpacing, context)
					} catch (e) {
						handle(e, '~text: Letter spacing')
					}
				}

				// Font weight. Make sure to use double equals to catch nulls and strings <-> numbers
				if (from.fontWeight == to.fontWeight) {
					rules['font-weight'] = from.fontWeight ? from.fontWeight + '' : null
				} else {
					log.warn('~text', `Mismatched font weights`)
				}

				return rules
			}
		},
		{
			values: fontSizeValues,
			modifiers: fontSizeModifiers,
			supportsNegativeValues: false,
			type: ['absolute-size', 'relative-size', 'length', 'percentage']
		}
	)

	// Screen variants
	// ---

	if (screens?.DEFAULT) {
		log.warn(
			'inaccessible-default-screen',
			`Your DEFAULT screen breakpoint must be renamed to be used in fluid variants`
		)
	}

	Object.entries(screens).forEach(([s1Key, s1]) => {
		// Add `~screen/screen` variants
		Object.entries(screens).forEach(([s2Key, s2]) => {
			if (s2Key === s1Key) return
			addVariant(api, `~${s1Key}/${s2Key}`, ({ container }) => {
				try {
					expr.rewrite(container, context, [s1, s2])
					return '&'
				} catch (e) {
					handle(e, `~${s1Key}/${s2Key}`)
					return []
				}
			})
		})

		// Add `~screen/[arbitrary]?` variants
		addVariantWithModifier(api, `~${s1Key}`, ({ container, modifier }) => {
			try {
				expr.rewrite(container, context, [s1, modifier])
				return '&'
			} catch (e) {
				handle(e, `~${s1Key}${modifier ? '/' + modifier : ''}`)
				return []
			}
		})

		// Add `~/screen` variants
		addVariant(api, `~/${s1Key}`, ({ container }) => {
			try {
				expr.rewrite(container, context, [, s1])
				return '&'
			} catch (e) {
				handle(e, `~/${s1Key}`)
				return []
			}
		})
	})

	// Add `~/[arbitrary]?` variant
	addVariantWithModifier(api, '~', ({ modifier, container }) => {
		try {
			expr.rewrite(container, context, [, modifier])
			return '&'
		} catch (e) {
			handle(e, `~${modifier ? '/' + modifier : ''}`)
			return []
		}
	})

	// Add `~min-[arbitrary]/(screen|[arbitrary])?` variant
	matchVariant(api, '~min', (value, { modifier, container }) => {
		try {
			expr.rewrite(container, context, [value, modifier])
			return '&'
		} catch (e) {
			handle(e, `~min-[${value}]${modifier ? '/' + modifier : ''}`)
			return []
		}
	})

	// Container variants
	// ---
	if (!containers) return // ensure official container query plugin exists

	if (containers?.DEFAULT) {
		log.warn(
			'inaccessible-default-container',
			`Your DEFAULT container breakpoint must be renamed to be used in fluid variants`
		)
	}

	Object.entries(containers).forEach(([c1Key, c1]) => {
		// Add `~@container/container` variants
		Object.entries(containers).forEach(([c2Key, c2]) => {
			if (c2Key === c1Key) return
			addVariant(api, `~@${c1Key}/${c2Key}`, ({ container }) => {
				try {
					expr.rewrite(container, context, [c1, c2], true)
					return '&'
				} catch (e) {
					handle(e, `~@${c1Key}/${c2Key}`)
					return []
				}
			})
		})

		// Add `~@container/[arbitrary]?` variants
		addVariantWithModifier(api, `~@${c1Key}`, ({ container, modifier }) => {
			try {
				expr.rewrite(container, context, [c1, modifier], true)
				return '&'
			} catch (e) {
				handle(e, `~@${c1Key}${modifier ? '/' + modifier : ''}`)
				return []
			}
		})

		// Add `~@/container` variants
		addVariant(api, `~@/${c1Key}`, ({ container }) => {
			try {
				expr.rewrite(container, context, [, c1], true)
				return '&'
			} catch (e) {
				handle(e, `~@/${c1Key}`)
				return []
			}
		})
	})

	// Add ~@[arbitrary]|container/[arbitrary]|container variant
	matchVariant(
		api,
		'~@',
		(value, { modifier, container }) => {
			try {
				expr.rewrite(container, context, [value, modifier], true)
				return '&'
			} catch (e) {
				handle(e, `~@`) // can't output ${value} without a reverse lookup from theme :/
				return []
			}
		},
		{
			values: {
				...containers,
				DEFAULT: null // so they can omit it and use expr.defaultContainers; see log.warn above
			}
		}
	)

	inFluidPlugin = false
})

export default fluid

/**
 * Tailwind's default screens converted to `rem`, for better
 * compatibility with core plugins.
 */
export const screens = mapObject(defaultTheme.screens ?? {}, (name, v) => {
	if (typeof v !== 'string') return [name, v]
	const len = Length.parse(v)
	if (!len || len.unit !== 'px') return [name, v]
	return [name, `${len.number / 16}rem`]
})

/**
 * Tailwind's default font sizes converted to `rem`, for better
 * compatibility with core plugins.
 */
export const fontSize = mapObject(
	defaultTheme.fontSize ?? {},
	(name, [_size, { lineHeight: _lineHeight }]) => {
		const size = Length.parse(_size)
		const lineHeightLength = Length.parse(_lineHeight)
		if (
			!size ||
			(lineHeightLength && lineHeightLength.number !== 0) ||
			isNaN(parseFloat(_lineHeight))
		)
			return [name, tuple([_size, _lineHeight])]

		return [
			name,
			tuple([_size, new Length(parseFloat(_lineHeight) * size.number, size.unit).cssText])
		]
	}
)

export { default as extract } from './extractor'
