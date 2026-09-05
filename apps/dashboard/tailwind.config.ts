import type { Config } from 'tailwindcss';

/** Designsystem von NEXUS (Regel 44): dunkel, kontrastreich, ruhig. */
const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        base: { 950: '#07080d', 900: '#0b0d14', 850: '#10131c', 800: '#161a26', 700: '#1f2433', 600: '#2b3244' },
        accent: { DEFAULT: '#5865f2', soft: '#7983f5', dim: '#3b45c4' },
        roblox: '#e2231a',
        success: '#3ba55d',
        warning: '#faa61a',
        danger: '#ed4245',
      },
      fontFamily: {
        sans: ['ui-sans-serif', 'system-ui', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      boxShadow: { glow: '0 0 0 1px rgba(88,101,242,0.25), 0 12px 40px -12px rgba(88,101,242,0.45)' },
      animation: { 'fade-in': 'fadeIn 200ms ease-out', 'slide-up': 'slideUp 220ms ease-out' },
      keyframes: {
        fadeIn: { from: { opacity: '0' }, to: { opacity: '1' } },
        slideUp: { from: { opacity: '0', transform: 'translateY(8px)' }, to: { opacity: '1', transform: 'translateY(0)' } },
      },
    },
  },
  plugins: [],
};

export default config;
