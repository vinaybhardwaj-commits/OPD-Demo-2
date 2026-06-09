import type { Config } from 'tailwindcss';

/**
 * Even Hospital design tokens.
 *
 * Brand palette (from COWORK-HANDOFF.md §2):
 *   #0055FF  Even Blue        — primary action, links, focused elements
 *   #002054  Even Navy        — headers, primary text on light backgrounds
 *   #F96EB1  Even Pink        — accent, warning/attention, secondary actions
 *   #FCFCFC  Even White       — page background, surfaces
 *
 * Use the semantic names (`even.blue`, `even.navy`, ...) so we can swap shades
 * later without touching components. Numeric scale (50–950) generated for each
 * brand colour from the brand mid-tone so we have hover/disabled/focus rings
 * out of the box.
 */
const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        even: {
          blue: {
            DEFAULT: '#0055FF',
            50: '#EBF1FF',
            100: '#D6E3FF',
            200: '#ADC7FF',
            300: '#85ABFF',
            400: '#5C8FFF',
            500: '#3373FF',
            600: '#0055FF', // brand
            700: '#0044CC',
            800: '#003399',
            900: '#002266',
            950: '#001133',
          },
          navy: {
            DEFAULT: '#002054',
            50: '#E6EBF2',
            100: '#CCD7E5',
            200: '#99B0CC',
            300: '#6688B2',
            400: '#336199',
            500: '#003B7F',
            600: '#003066',
            700: '#002A5C',
            800: '#002054', // brand
            900: '#001640',
            950: '#000D26',
          },
          pink: {
            DEFAULT: '#F96EB1',
            50: '#FEEEF6',
            100: '#FDDDED',
            200: '#FCBADC',
            300: '#FB97CA',
            400: '#FA82BD',
            500: '#F96EB1', // brand
            600: '#F73E97',
            700: '#E81077',
            800: '#B30D5C',
            900: '#7E0941',
            950: '#490526',
          },
          white: {
            DEFAULT: '#FCFCFC',
            cream: '#F9F8F4',
          },
          // Greyscale ramp tuned to the brand
          ink: {
            50: '#F7F8FA',
            100: '#EDEEF2',
            200: '#D6D9E0',
            300: '#B5BAC5',
            400: '#8C93A3',
            500: '#646B7A',
            600: '#454B58',
            700: '#2E323B',
            800: '#1B1E24',
            900: '#0B0D11',
          },
        },
      },
      fontFamily: {
        sans: [
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          'Roboto',
          'Helvetica Neue',
          'Arial',
          'sans-serif',
        ],
      },
    },
  },
  plugins: [],
};

export default config;
