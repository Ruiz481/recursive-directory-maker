/**
 * Core recursive directory creation logic.
 *
 * Race-safety strategy: after attempting to create each directory in the
 * chain, we check the error. If the directory now exists (either because a
 * concurrent creator made it or because it pre-existed), we treat that as
 * success and continue. Any other error — permissions, ENOSPC, an ENOTDIR
 * on a path component that is a regular file — propagates.
 *
 * Why not stat-then-mkdir: that pattern has a TOCTOU window between the
 * stat() call and the mkdir() call. mkdir() failing with EEXIST is the
 * kernel's own atomic "already exists" signal, so we rely on that instead.
 */

import { mkdir, stat } from 'node:fs/promises';
import { join, parse, isAbsolute } from 'node:path';

/**
 * Determine whether an error thrown by mkdir() means "directory already
 * exists and is a directory" — the only benign outcome we tolerate.
 *
 * On POSIX, EEXIST is returned when the path exists (file or directory).
 * On Windows, when a junction or symlink points at the path, mkdir can
 * surface as EEXIST too. We do not attempt to disambiguate file-vs-dir
 * here; the subsequent call in the chain will fail with ENOTDIR if the
 * path is a file, which is the correct outcome — silently masking a
 * regular-file-as-path-component would be worse.
 *
 * @param {unknown} err
 * @returns {boolean}
 */
function isBenignExistence(err) {
  if (!(err instanceof Error)) return false;
  const code = /** @type {NodeJS.ErrnoException} */ (err).code;
  return code === 'EEXIST';
}

/**
 * Convert a path to its absolute form when `root` is provided. If `root` is
 * null, the path is used as-is (and must already be absolute or relative to
 * cwd). We intentionally do NOT resolve against process.cwd() ourselves
 * when root is null — doing so would make behaviour depend on the caller's
 * working directory, which is exactly the kind of implicit side-effect this
 * library is trying to avoid.
 *
 * @param {string} path
 * @param {string|null} root
 * @returns {string}
 */
function resolvePath(path, root) {
  if (root === null) return path;
  return isAbsolute(path) ? path : join(root, path);
}

/**
 * Build the ordered list of ancestor directories that must exist for `fullPath`
 * to be creatable. The list is shortest-first (the root ancestor first, the
 * full path last) so that creation proceeds outside-in.
 *
 * We walk up from the full path's parent to the volume root, collecting
 * components, then reverse. `path.parse` gives us `root` (e.g. '/' or 'C:\\')
 * and `dir`. We stop once `dir` equals `root` or is empty — both indicate
 * we've reached the top.
 *
 * @param {string} fullPath
 * @returns {string[]}
 */
function buildChain(fullPath) {
  const parts = [];
  let current = parse(fullPath).dir;
  const top = parse(fullPath).root;
  // Guard against an infinite loop if the filesystem reports a self-referential
  // parent (which real filesystems do not, but parse() on a bare path like
  // 'foo' returns dir '' and root '' — we handle that by stopping).
  let iterations = 0;
  while (current && current !== top && iterations < 256) {
    parts.push(current);
    const parent = parse(current).dir;
    if (parent === current) break;
    current = parent;
    iterations++;
  }
  // shortest-first: root ancestor, then progressively deeper, then the path itself
  parts.reverse();
  parts.push(fullPath);
  return parts;
}

/**
 * @typedef {Object} MakeDirOptions
 * @property {number|null} [mode] POSIX permission bits for created directories.
 *   null means "use the process umask-derived default". On Windows this is
 *   accepted but has no effect, matching Node's own fs.mkdir behaviour.
 * @property {string|null} [root] An absolute base path to resolve relative
 *   `path` arguments against. null (the default) means use `path` verbatim.
 *   When set, passing an absolute `path` to makeDirs is an error — this
 *   prevents the caller from accidentally escaping an intended sandbox.
 */

/**
 * Recursively create `path` and any missing ancestors.
 *
 * If `path` already exists and is a directory, this is a no-op (we detect it
 * via EEXIST from mkdir, not via a pre-flight stat). If `path` exists and is a
 * file, we throw ENOTDIR-like behaviour — mkdir refuses to overwrite.
 *
 * We deliberately do NOT use Node's recursive: true option. That option
 * provides no way to distinguish "created" from "already existed", and it
 * silently masks some error conditions we want to surface.
 *
 * @param {string} path Directory to create (relative to `root` if given).
 * @param {MakeDirOptions} [opts]
 * @returns {Promise<void>}
 */
export async function makeDirs(path, opts = {}) {
  if (typeof path !== 'string' || path.length === 0) {
    throw new TypeError('path must be a non-empty string');
  }
  const mode = opts.mode === undefined ? null : opts.mode;
  const root = opts.root === undefined ? null : opts.root;

  if (root !== null) {
    if (typeof root !== 'string' || root.length === 0) {
      throw new TypeError('root must be a non-empty string when provided');
    }
    if (!isAbsolute(root)) {
      throw new Error('root must be an absolute path');
    }
    if (isAbsolute(path)) {
      throw new Error('path must be relative when root is provided');
    }
  }

  const fullPath = resolvePath(path, root);
  const chain = buildChain(fullPath);

  for (const dir of chain) {
    try {
      const mkdirOpts = mode === null ? {} : { mode };
      await mkdir(dir, mkdirOpts);
    } catch (err) {
      if (isBenignExistence(err)) {
        // Verify it's actually a directory. If a regular file claimed the
        // name, the NEXT mkdir in the chain will fail with ENOTDIR on POSIX,
        // which propagates. But for the final segment we check explicitly so
        // the error is meaningful rather than a silent no-op.
        try {
          const s = await stat(dir);
          if (!s.isDirectory()) {
            throw new Error(`Path component '${dir}' exists and is not a directory`);
          }
        } catch (statErr) {
          // If stat itself failed (e.g. permission denied reading the parent),
          // surface that rather than masking it.
          throw statErr;
        }
        continue;
      }
      throw err;
    }
  }
}
