# Mindful Google Ads Solutions Architect — Design Spec

## Overview

Transform the current "Hubs" blog into a **Google Ads Solutions Architect** platform with three core features: a chat-first homepage, a knowledge library, and SEA case study blog with an interactive map.

## Branding

- **Name:** Mindful Google Ads Solutions Architect
- **Visual identity:** Corporate Google partner look — white backgrounds, Google 4-color palette (#4285F4, #EA4335, #FBBC05, #34A853), DM Sans typography
- **Header nav:** Home | Projects | Blog

## Homepage — Chat-First Experience

- Hero with title "Google Ads Solutions Architect" and subtitle
- Embedded chat interface as the primary UX
- Quick-action suggestion chips for common queries
- Featured resources row below chat linking to Projects/Blog
- Chat engine: client-side JS with JSON knowledge base (~100-150 Q&A pairs)
- Upgrade path: swap keyword matcher for Claude API fetch call

## Projects — Knowledge Library

- Restyle index as categorized library with filter tabs (All | Getting Started | Campaign Management | Optimization | Technical)
- Card grid with icons, category tags
- Existing Google Ads comprehensive guide is the flagship content

## Blog — SEA Case Studies with Interactive Map

- Interactive SVG map of Southeast Asia (Vietnam, Thailand, Indonesia, Malaysia, Philippines, Singapore)
- Click country to filter case studies
- Text tab filters below map as alternative
- 15 real case studies with proper attribution from Google's official resources
- Each post: challenge, solution, results (metric highlight card), key takeaway, source link

### Case Studies

| Company | Country | Industry | Key Result | Google Ads Product |
|---------|---------|----------|------------|--------------------|
| Ru9 | Vietnam | D2C Mattress | 900% ROI | Search |
| Amanotes | Vietnam | Mobile Gaming | -20% CPI | App Campaigns |
| GoGa | Vietnam | Service Platform | -20% CPL | Performance Max |
| The One Digi Corp | Vietnam | Visa Services | 2X revenue | Search |
| Tri Petch Isuzu | Thailand | Automotive | +67% leads | Search |
| 12Go | Thailand | Travel Agency | 3.3X conversion value | Search |
| Sayurbox | Indonesia | Online Grocery | 3,000+ orders/day | Google Ads |
| Sarung BHS | Indonesia | Textiles | 2X sales in 2 months | Google Ads |
| PT Karya Pangan | Indonesia | Food Mfg | 6X traffic | Search |
| Traveloka | Indonesia | Travel | +11% ROAS | DSA + Smart Bidding |
| AirAsia | Malaysia | Airlines | +21% bookings | Dynamic Search Ads |
| Kilang Besi | Malaysia | Steel B2B | 3,000% ROI | Search |
| Cebu Pacific | Philippines | Airlines | 7X ROAS | Display & Video 360 |
| Shopee | Singapore | E-commerce | 2X orders | AI Max / Shopping |
| Klook | APAC | Travel | +161% conversion value | AI Max / YouTube |

## Architecture

- **Framework:** Astro (static) + GitHub Pages
- **Styling:** Tailwind CSS + custom Google-style component classes
- **Interactivity:** Vanilla JS (chat engine, map, filters)
- **Content:** MDX for all pages

### Key Files

```
src/
├── components/
│   ├── ChatBot.astro
│   ├── SeaMap.astro
│   ├── CountryFilter.astro
│   └── CaseStudyCard.astro
├── data/
│   └── knowledge-base.json
├── pages/
│   ├── index.astro (chat-first homepage)
│   ├── blog/index.astro (map + filtered grid)
│   └── projects/index.astro (library with categories)
├── content/blog/ (15 case study MDX files)
└── scripts/
    └── chat-engine.js
```

## Chat Engine Design

- `knowledge-base.json`: array of `{keywords: [], category: string, question: string, answer: string, links: []}`
- `chat-engine.js`: tokenizes user input, scores against keyword matches, returns top answer
- Fallback response links to the comprehensive guide
- Interface: `getResponse(query) => {answer, links, category}`
- Upgrade: replace with `fetch('https://api.anthropic.com/v1/messages')` + API key
