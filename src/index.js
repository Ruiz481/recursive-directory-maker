/**
 * Public entry point for the recursive-directory-maker library.
 *
 * Re-exports the single implementation. Keeping the indirection allows the
 * core module to be tested directly and the index to remain stable if the
 * internals are refactored later.
 */

export { makeDirs } from './core.js';
