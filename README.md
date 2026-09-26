# Recursive Directory Maker

A small Node.js library that creates nested directory paths, including all missing ancestors, with race-safe handling for the case where the path already exists.

## Usage

```js
import { makeDirs } from 'recursive-directory-maker';

await makeDirs('/var/data/cache/images/thumbnails');

// With an absolute sandbox root (relative path resolved against it):
await makeDirs('cache/images', { root: '/var/data' });
```

## Why

Node's `fs.mkdir(..., { recursive: true })` exists, but it gives no signal back about whether it actually created anything, and it silently swallows a class of errors that this library surfaces. `makeDirs` walks the ancestor chain one component at a time, calling `mkdir` on each. If `mkdir` reports `EEXIST`, the library confirms the entry is a directory and continues; anything else propagates. This trades a small amount of performance (one syscall per path component) for explicit, predictable error handling.

## Edge cases

- If a path component exists as a regular file (not a directory), `makeDirs` throws. It does not attempt to remove or overwrite the file.
- When `root` is provided, `path` must be relative. Passing an absolute path alongside a `root` is treated as a programmer error and rejected, because it usually means the caller is trying to escape an intended sandbox.
- The `mode` option sets POSIX permission bits on created directories only. On Windows it is accepted but has no effect, matching Node's own behaviour.
