// Re-exports the shared server/client lesson-rendering module. This is the
// ONE place in src/ that crosses into public/js/ — every other src/ file
// should import escapeHtml/renderContent/getTopicSVG from here, not compute
// its own relative path into public/js/, so there's a single spot to fix if
// that module ever moves. See CLAUDE.md's "Homepage topic grid" section for
// why topic-render.js is dependency-free and shared between worker-side SSR
// and public/js/main.js's client-side render.
export { escapeHtml, renderContent, getTopicSVG } from '../../public/js/topic-render.js';
