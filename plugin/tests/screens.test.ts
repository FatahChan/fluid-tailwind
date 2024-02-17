import { expect, it } from 'bun:test'
import './matchers'
import { html, css, run } from './run'
import { type FluidConfig } from '../src'

it(`allows ~screen/screen variant`, async () => {
	const { result } = await run({
		content: [
			{
				raw: html`<div class="~md/lg:~p-1/2"></div>`
			}
		],
		theme: {
			screens: {
				md: '30rem',
				lg: '80rem'
			}
		}
	})
	expect(result.css).toMatchFormattedCss(css`
		.\~md\/lg\:\~p-1\/2 {
			padding: clamp(
				0.25rem,
				0.1rem + 0.5vw,
				0.5rem
			); /* fluid from 0.25rem at 30rem to 0.5rem at 80rem */
		}
	`)
})

it(`allows ~screen variant`, async () => {
	const { result } = await run({
		content: [
			{
				raw: html`<div class="~md:~p-1/2"></div>`
			}
		],
		theme: {
			screens: {
				md: '30rem',
				lg: '80rem'
			}
		}
	})
	expect(result.css).toMatchFormattedCss(css`
		.\~md\:\~p-1\/2 {
			padding: clamp(
				0.25rem,
				0.1rem + 0.5vw,
				0.5rem
			); /* fluid from 0.25rem at 30rem to 0.5rem at 80rem */
		}
	`)
})

it(`allows ~screen/[arbitrary] variant`, async () => {
	const { result } = await run({
		content: [
			{
				raw: html`<div class="~md/[80rem]:~p-1/2"></div>`
			}
		],
		theme: {
			screens: {
				md: '30rem'
			}
		}
	})
	expect(result.css).toMatchFormattedCss(css`
		.\~md\/\[80rem\]\:\~p-1\/2 {
			padding: clamp(
				0.25rem,
				0.1rem + 0.5vw,
				0.5rem
			); /* fluid from 0.25rem at 30rem to 0.5rem at 80rem */
		}
	`)
})

it(`allows ~/screen variant`, async () => {
	const { result } = await run({
		content: [
			{
				raw: html`<div class="~/lg:~p-1/2"></div>`
			}
		],
		theme: {
			screens: {
				md: '30rem',
				lg: '80rem'
			}
		}
	})
	expect(result.css).toMatchFormattedCss(css`
		.\~\/lg\:\~p-1\/2 {
			padding: clamp(
				0.25rem,
				0.1rem + 0.5vw,
				0.5rem
			); /* fluid from 0.25rem at 30rem to 0.5rem at 80rem */
		}
	`)
})

it(`allows ~/[arbitrary] variant`, async () => {
	const { result } = await run({
		content: [
			{
				raw: html`<div class="~/[80rem]:~p-1/2"></div>`
			}
		],
		theme: {
			screens: {
				md: '30rem'
			}
		}
	})
	expect(result.css).toMatchFormattedCss(css`
		.\~\/\[80rem\]\:\~p-1\/2 {
			padding: clamp(
				0.25rem,
				0.1rem + 0.5vw,
				0.5rem
			); /* fluid from 0.25rem at 30rem to 0.5rem at 80rem */
		}
	`)
})

it(`allows ~min-[arbitrary] variant`, async () => {
	const { result } = await run({
		content: [
			{
				raw: html`<div class="~min-[30rem]:~p-1/2"></div>`
			}
		],
		theme: {
			screens: {
				lg: '80rem'
			}
		}
	})
	expect(result.css).toMatchFormattedCss(css`
		.\~min-\[30rem\]\:\~p-1\/2 {
			padding: clamp(
				0.25rem,
				0.1rem + 0.5vw,
				0.5rem
			); /* fluid from 0.25rem at 30rem to 0.5rem at 80rem */
		}
	`)
})

it(`allows ~min-[arbitrary]/screen variant`, async () => {
	const { result } = await run({
		content: [
			{
				raw: html`<div class="~min-[30rem]/lg:~p-1/2"></div>`
			}
		],
		theme: {
			screens: {
				lg: '80rem'
			}
		}
	})
	expect(result.css).toMatchFormattedCss(css`
		.\~min-\[30rem\]\/lg\:\~p-1\/2 {
			padding: clamp(
				0.25rem,
				0.1rem + 0.5vw,
				0.5rem
			); /* fluid from 0.25rem at 30rem to 0.5rem at 80rem */
		}
	`)
})

it(`allows ~min-[arbitrary]/[arbitrary] variant`, async () => {
	const { result } = await run({
		content: [
			{
				raw: html`<div class="~min-[30rem]/[80rem]:~p-1/2"></div>`
			}
		]
	})
	expect(result.css).toMatchFormattedCss(css`
		.\~min-\[30rem\]\/\[80rem\]\:\~p-1\/2 {
			padding: clamp(
				0.25rem,
				0.1rem + 0.5vw,
				0.5rem
			); /* fluid from 0.25rem at 30rem to 0.5rem at 80rem */
		}
	`)
})

it(`fails if ~ variant is used on non-fluid utility`, async () => {
	const { result, warn } = await run({
		content: [
			{
				raw: html`<div class="~:relative"></div>`
			}
		]
	})
	expect(result.css).toMatchFormattedCss(css``)
	expect(warn).toHaveBeenCalledWith(
		'no-utility',
		'~: Fluid variants can only be used with fluid utilities'
	)
})

it(`fails if ~ variant is used with same start/end screens`, async () => {
	const { result, warn } = await run({
		content: [
			{
				raw: html`<div class="~md/[30rem]:~p-1/2"></div>`
			}
		],
		theme: {
			screens: {
				md: '30rem'
			}
		}
	})
	expect(result.css).toMatchFormattedCss(css``)
	expect(warn).toHaveBeenCalledWith(
		'no-change-bp',
		'~md/[30rem]: Start and end breakpoints are both 30rem'
	)
})

it(`fails if no screens`, async () => {
	const { result, warn } = await run({
		content: [
			{
				raw: html`<div class="~p-1/2"></div>`
			}
		],
		theme: {
			screens: {}
		}
	})
	expect(result.css).toMatchFormattedCss(``)
	expect(warn).toHaveBeenCalledWith(
		'missing-default-start-bp',
		'~p: Missing default start breakpoint'
	)
})

it(`fails if screens with different units`, async () => {
	const { result, warn } = await run({
		content: [
			{
				raw: html`<div class="~p-1/2"></div>`
			}
		],
		theme: {
			screens: {
				sm: '30rem',
				lg: '960px'
			}
		}
	})
	expect(result.css).toMatchFormattedCss(``)
	expect(warn).toHaveBeenCalledWith(
		'sort-mismatched-bp-units',
		'~p: Cannot sort simple breakpoints in `theme.screens` because they use different units'
	)
})

it(`supports missing start defaultScreen`, async () => {
	const { result } = await run({
		content: [
			{
				raw: html`<div class="~p-1/2"></div>`
			}
		],
		theme: {
			fluid: {
				defaultScreens: [, '80rem']
			} satisfies FluidConfig,
			screens: {
				sm: '30rem'
			}
		}
	})
	expect(result.css).toMatchFormattedCss(css`
		.\~p-1\/2 {
			padding: clamp(
				0.25rem,
				0.1rem + 0.5vw,
				0.5rem
			); /* fluid from 0.25rem at 30rem to 0.5rem at 80rem */
		}
	`)
})

it(`supports missing end defaultScreen`, async () => {
	const { result } = await run({
		content: [
			{
				raw: html`<div class="~p-1/2"></div>`
			}
		],
		theme: {
			fluid: {
				defaultScreens: ['30rem']
			} satisfies FluidConfig,
			screens: {
				lg: '80rem'
			}
		}
	})
	expect(result.css).toMatchFormattedCss(css`
		.\~p-1\/2 {
			padding: clamp(
				0.25rem,
				0.1rem + 0.5vw,
				0.5rem
			); /* fluid from 0.25rem at 30rem to 0.5rem at 80rem */
		}
	`)
})
