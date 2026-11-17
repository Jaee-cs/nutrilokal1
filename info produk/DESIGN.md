---
name: NutriLokal Editorial Minimal
colors:
  surface: '#f7faf5'
  surface-dim: '#d8dbd6'
  surface-bright: '#f7faf5'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f1f4f0'
  surface-container: '#ecefea'
  surface-container-high: '#e6e9e4'
  surface-container-highest: '#e0e3df'
  on-surface: '#191c1a'
  on-surface-variant: '#414844'
  inverse-surface: '#2d312e'
  inverse-on-surface: '#eff2ed'
  outline: '#717973'
  outline-variant: '#c1c8c2'
  surface-tint: '#3f6653'
  primary: '#012d1d'
  on-primary: '#ffffff'
  primary-container: '#1b4332'
  on-primary-container: '#86af99'
  inverse-primary: '#a5d0b9'
  secondary: '#116c4a'
  on-secondary: '#ffffff'
  secondary-container: '#a1f4c8'
  on-secondary-container: '#1b724f'
  tertiary: '#152b1c'
  on-tertiary: '#ffffff'
  tertiary-container: '#2a4131'
  on-tertiary-container: '#93ad98'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#c1ecd4'
  primary-fixed-dim: '#a5d0b9'
  on-primary-fixed: '#002114'
  on-primary-fixed-variant: '#274e3d'
  secondary-fixed: '#a1f4c8'
  secondary-fixed-dim: '#86d7ad'
  on-secondary-fixed: '#002113'
  on-secondary-fixed-variant: '#005236'
  tertiary-fixed: '#cee9d3'
  tertiary-fixed-dim: '#b3cdb7'
  on-tertiary-fixed: '#092012'
  on-tertiary-fixed-variant: '#354c3b'
  background: '#f7faf5'
  on-background: '#191c1a'
  surface-variant: '#e0e3df'
typography:
  headline-xl:
    fontFamily: Plus Jakarta Sans
    fontSize: 40px
    fontWeight: '700'
    lineHeight: 48px
    letterSpacing: -0.02em
  headline-xl-mobile:
    fontFamily: Plus Jakarta Sans
    fontSize: 30px
    fontWeight: '700'
    lineHeight: 38px
    letterSpacing: -0.015em
  headline-lg:
    fontFamily: Plus Jakarta Sans
    fontSize: 28px
    fontWeight: '600'
    lineHeight: 36px
    letterSpacing: -0.01em
  headline-md:
    fontFamily: Plus Jakarta Sans
    fontSize: 22px
    fontWeight: '600'
    lineHeight: 30px
  headline-sm:
    fontFamily: Plus Jakarta Sans
    fontSize: 18px
    fontWeight: '600'
    lineHeight: 26px
  body-lg:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 26px
  body-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 22px
  body-sm:
    fontFamily: Inter
    fontSize: 13px
    fontWeight: '400'
    lineHeight: 20px
  label-lg:
    fontFamily: Plus Jakarta Sans
    fontSize: 15px
    fontWeight: '600'
    lineHeight: 20px
  label-md:
    fontFamily: Plus Jakarta Sans
    fontSize: 13px
    fontWeight: '500'
    lineHeight: 18px
  label-sm:
    fontFamily: Plus Jakarta Sans
    fontSize: 11px
    fontWeight: '600'
    lineHeight: 16px
    letterSpacing: 0.04em
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  gutter: 1.25rem
  margin: 1.5rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 1rem
  space-lg: 1.5rem
  space-xl: 2.5rem
---

## Brand & Style

This design system expresses sustainable agriculture, community empowerment, and modern supply chain transparency. Tailored specifically for rural-to-urban agri-food initiatives like Kelompok Wanita Tani (KWT) Gogor in Gunungkidul, the visual language balances grassroots warmth with clean, dependable digital infrastructure.

The core aesthetic combines **Minimalism** with organic warmth:
- Generous breathing room and airy whitespace that make agricultural data feel unhurried, digestible, and organized.
- Deep, verdant foliage tones grounded by gentle botanical off-whites, deliberately moving away from harsh pure whites or utilitarian institutional interfaces.
- Intentional typography that prioritizes effortless legibility across field operations, batch tracing, and catalog browsing.
- Soft, humanized structure avoiding aggressive borders or high-contrast drop shadows.

## Colors

The palette establishes an organic, quiet authority rooted in nature:

- **Primary (`#1b4332`)**: Deep Forest Green. Used for primary CTAs, main titles, strong brand marks, and active states. Conveys stability, grounded governance, and trust.
- **Secondary (`#40916c`)**: Balanced Sage Green. Used for supportive iconography, sub-headings, interactive focus states, and secondary visual accents.
- **Tertiary (`#d8f3dc`)**: Soft Mint Wash. Used for informational pill badges, subtle card fills, traceability tags, and success indicator backdrops.
- **Neutral (`#2d312e`)**: Deep Mineral Charcoal. Employed strictly for body copy, secondary metadata, and icon fills to avoid the sterile harshness of true `#000000`.

### Background Tones & Surfaces
- **Canvas Base**: `#fbfbf9` (Soft Warm Pearl). Replaces default bright white to maintain a relaxed, premium paper feel.
- **Surface Elevation 1**: `#f3f4ef` (Muted Warm Sage Tint) for cards, section containers, and input fields.
- **Border Subtle**: `#e3e5dc` (Whisper Gray-Green) for featherlight dividers and delicate card boundaries.

## Typography

The pairing between **Plus Jakarta Sans** and **Inter** bridges welcoming warmth with utilitarian precision.

- **Headlines & Display:** Plus Jakarta Sans provides organic curves and geometric clarity. Generous line heights ensure headings feel breathable and non-aggressive.
- **Body & Continuous Reading:** Inter supplies neutral, high-legibility rendering, essential when reviewing traceability records, harvest batch numbers, and production dates.
- **Labels & Microcopy:** Kept uppercase or medium weight with slight positive letter spacing to establish quick visual scanning in logistical interfaces.

## Layout & Spacing

The layout is built upon an adaptive 12-column fluid grid designed to scale cleanly from single-hand mobile interactions in packing centers to desktop administration dashboards.

### Responsive Breakpoints
- **Mobile (up to 640px):** 4-column layout, `margin: 1.25rem`, `gutter: 1rem`. Focus is placed on vertical stacking, spacious button tap targets (minimum 48px height), and uncluttered data displays.
- **Tablet (641px - 1024px):** 8-column layout, `margin: 2rem`, `gutter: 1.5rem`.
- **Desktop (1025px and up):** 12-column layout, max content constraint of `76rem` (1216px), `margin: auto`, `gutter: 1.5rem`. Content breathes with generous whitespace rather than expanding indefinitely.

### Spacing Philosophy
Consistent vertical pacing follows multiples of 8px. Spacing between distinct logical blocks should lean towards `space-xl` (`2.5rem`) to keep the page calm and uncluttered.

## Elevation & Depth

This system avoids dark, synthetic box shadows, relying instead on **tonal layers** and ultra-soft ambient contact diffusion.

- **Level 0 (Flat / Canvas):** Neutral warm canvas `#fbfbf9`. No shadow.
- **Level 1 (Cards, Groupings):** Solid surface tint `#f3f4ef` or pure white `#ffffff` accompanied by a soft, warm ambient occlusion: `box-shadow: 0 2px 8px -2px rgba(27, 67, 50, 0.05)`.
- **Level 2 (Dropdowns, Floating Navigation, Popovers):** Elevated surface with featherlight ambient drop: `box-shadow: 0 8px 24px -4px rgba(27, 67, 50, 0.08)`.
- **Outlines:** Low-contrast ghost borders (`#e3e5dc`, 1px solid) are utilized only when elements must be distinguished over photographic backgrounds or during input hover/focus states.

## Shapes

The shape rhythm applies a balanced roundedness (`8px` to `12px` default) that is friendly yet professional:

- Standard elements (interactive buttons, input fields, badges) use `0.5rem` (8px).
- Structural containers (cards, summary banners, dialog modals) use `rounded-lg` (`0.75rem` / 12px) to soft-frame data.
- Full pill radii (`9999px`) are reserved exclusively for contextual status chips and location tags.

## Components

### Buttons
- **Primary Action:** Solid background in `#1b4332`, text `#ffffff`. Flat design without gradient or bevel. Hover shifts subtly to `#2d6a4f`. Padding: `0.75rem 1.5rem`, height: 48px, border-radius: 10px.
- **Secondary / Outline:** Background transparent, subtle border 1.5px solid `#1b4332`, text `#1b4332`. Hover introduces a wash of `#d8f3dc` at 40% opacity.
- **Subtle / Ghost:** Background `#f3f4ef`, text `#1b4332`. Borderless. For secondary system actions like operator switches.

### Chips & Badges
- Location & provenance indicators: Rounded full (`pill`), background `#d8f3dc` with text `#1b4332`. Height: 32px, padding: `0.25rem 0.875rem`. Paired with a muted green leading pin icon.
- Batch status tags (e.g., "Tersedia", "Proses Panen"): Subtle background `#f3f4ef`, border 1px solid `#e3e5dc`, text `#2d312e`.

### Input Fields & Controls
- **Form Inputs:** Background `#ffffff`, border 1px solid `#e3e5dc`. Corner radius: 10px. Active focus adds a 1.5px ring of `#40916c` with 0px outline offset.
- **Selection Controls (Checkboxes & Radios):** Custom styled with `#1b4332` fill when active, soft `#e3e5dc` stroke when idle. Check marks are clean geometric lines in pure white.

### Cards
- **Product & Batch Cards:** White `#ffffff` background with 1px border `#e3e5dc`, rounded 12px. Padding: `1.25rem`. No stark shadow; depth is conveyed through internal typographic hierarchy and clean spacing.

### Traceability Bar & Feature Callouts
- Horizontal list items with soft pastel background tokens (`#f3f4ef`), featuring thin line icons (QR, Leaf, Shield) in `#2d6a4f` with a 24px footprint and generous horizontal label alignment.