import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, stat, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeDirs } from '../src/index.js';

/**
 * Each test gets a freshly created temp directory as a sandbox. We never
 * write outside it, so tests are hermetic and parallel-safe.
 */
async function makeSandbox() {
  const base = await mkdtemp(join(tmpdir(), 'recdir-'));
  return {
    base,
    async cleanup() {
      await rm(base, { recursive: true, force: true });
    },
  };
}

describe('makeDirs', () => {
  it('creates a single directory when it does not exist', async () => {
    const sb = await makeSandbox();
    try {
      const target = join(sb.base, 'leaf');
      await makeDirs(target);
      const s = await stat(target);
      assert.equal(s.isDirectory(), true);
    } finally {
      await sb.cleanup();
    }
  });

  it('creates nested directories across multiple levels', async () => {
    const sb = await makeSandbox();
    try {
      const target = join(sb.base, 'a', 'b', 'c', 'd');
      await makeDirs(target);
      const s = await stat(target);
      assert.equal(s.isDirectory(), true);
    } finally {
      await sb.cleanup();
    }
  });

  it('is a no-op when the path already exists as a directory', async () => {
    const sb = await makeSandbox();
    try {
      const target = join(sb.base, 'existing');
      await mkdir(target);
      // Should not throw; should leave the directory intact.
      await makeDirs(target);
      const s = await stat(target);
      assert.equal(s.isDirectory(), true);
    } finally {
      await sb.cleanup();
    }
  });

  it('creates only the missing intermediate segments when ancestors exist', async () => {
    const sb = await makeSandbox();
    try {
      const middle = join(sb.base, 'x', 'y');
      await mkdir(middle, { recursive: true });
      const target = join(middle, 'z');
      await makeDirs(target);
      const s = await stat(target);
      assert.equal(s.isDirectory(), true);
      // Ensure we didn't recreate the middle.
      const ms = await stat(middle);
      assert.equal(ms.isDirectory(), true);
    } finally {
      await sb.cleanup();
    }
  });

  it('rejects a non-empty string path requirement', async () => {
    await assert.rejects(
      () => makeDirs(''),
      /path must be a non-empty string/,
    );
  });

  it('rejects a non-string path', async () => {
    await assert.rejects(
      // @ts-expect-error testing runtime guard
      () => makeDirs(123),
      /path must be a non-empty string/,
    );
  });

  it('throws when a path component is a regular file, not a directory', async () => {
    const sb = await makeSandbox();
    try {
      const blocker = join(sb.base, 'blocker');
      await writeFile(blocker, 'data');
      const target = join(blocker, 'child');
      await assert.rejects(
        () => makeDirs(target),
        (err) => {
          // On POSIX, the underlying mkdir fails with ENOTDIR. We propagate
          // that error, OR our own "not a directory" message for the final
          // segment. Accept either since the exact layer depends on which
          // component triggered it.
          const msg = String(err && err.message ? err.message : err);
          return /not a directory|ENOTDIR/i.test(msg);
        },
      );
    } finally {
      await sb.cleanup();
    }
  });

  it('resolves a relative path against a provided root', async () => {
    const sb = await makeSandbox();
    try {
      await makeDirs('sub/leaf', { root: sb.base });
      const s = await stat(join(sb.base, 'sub', 'leaf'));
      assert.equal(s.isDirectory(), true);
    } finally {
      await sb.cleanup();
    }
  });

  it('rejects an absolute path when root is provided', async () => {
    const sb = await makeSandbox();
    try {
      await assert.rejects(
        () => makeDirs('/etc', { root: sb.base }),
        /path must be relative when root is provided/,
      );
    } finally {
      await sb.cleanup();
    }
  });

  it('rejects a non-absolute root', async () => {
    await assert.rejects(
      () => makeDirs('sub', { root: 'relative/root' }),
      /root must be an absolute path/,
    );
  });

  it('creates the full chain even when root points at an empty base', async () => {
    const sb = await makeSandbox();
    try {
      // root is the sandbox itself; path is deeply nested relative to it.
      await makeDirs('a/b/c/d/e', { root: sb.base });
      const s = await stat(join(sb.base, 'a', 'b', 'c', 'd', 'e'));
      assert.equal(s.isDirectory(), true);
    } finally {
      await sb.cleanup();
    }
  });

  it('handles a path that is exactly one level deep', async () => {
    const sb = await makeSandbox();
    try {
      const target = join(sb.base, 'only');
      await makeDirs(target);
      const s = await stat(target);
      assert.equal(s.isDirectory(), true);
    } finally {
      await sb.cleanup();
    }
  });
});
