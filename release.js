#!/usr/bin/env node
/*
 * Release: develop -> main, with a version bump and a tag.
 *
 * There is no staging branch and no release branch. main is production, and it
 * only ever receives develop, so every step here is a fast-forward and the
 * script refuses rather than inventing a merge commit.
 *
 * Run it from develop after pushing:  npm run release -- minor
 */
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.dirname(fileURLToPath(import.meta.url));
const SOURCE_BRANCH = "develop";
const TARGET_BRANCH = "main";
const VALID_BUMP_TYPES = new Set(["patch", "minor", "major"]);
const STABLE_VERSION = /^(\d+)\.(\d+)\.(\d+)$/;

process.chdir(REPO_ROOT);

function capture(command, args) {
  return execFileSync(command, args, { encoding: "utf8" }).trim();
}

function run(command, args) {
  execFileSync(command, args, { stdio: "inherit" });
}

function succeeds(command, args) {
  return spawnSync(command, args, { stdio: "ignore" }).status === 0;
}

function fail(message) {
  throw new Error(message);
}

function parseVersion(version) {
  const match = STABLE_VERSION.exec(version);
  if (!match) fail(`Expected a stable semantic version, got "${version}".`);
  return match.slice(1).map(Number);
}

function compareVersions(left, right) {
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

function bumpVersion([major, minor, patch], bumpType) {
  if (bumpType === "major") return [major + 1, 0, 0];
  if (bumpType === "minor") return [major, minor + 1, 0];
  return [major, minor, patch + 1];
}

const bumpType = process.argv[2] || "patch";
if (!VALID_BUMP_TYPES.has(bumpType)) {
  console.error("Usage: npm run release -- [patch|minor|major]");
  process.exit(1);
}

// Set once the script is no longer standing on develop, so the exit path knows
// it has somewhere to go back to.
let leftSourceBranch = false;

try {
  const workingTreeStatus = capture("git", ["status", "--porcelain"]);
  if (workingTreeStatus) {
    console.error("Working tree is not clean. Commit or stash these first:");
    console.error(workingTreeStatus);
    process.exit(1);
  }

  const currentBranch = capture("git", ["rev-parse", "--abbrev-ref", "HEAD"]);
  if (currentBranch !== SOURCE_BRANCH) {
    fail(`Run this from ${SOURCE_BRANCH}, not ${currentBranch}.`);
  }

  console.log(`Updating ${SOURCE_BRANCH} and fetching tags...`);
  run("git", ["fetch", "origin", "--tags", "--prune"]);
  run("git", ["pull", "--ff-only", "origin", SOURCE_BRANCH]);

  /*
   * Everything below this point writes something. The one plausible failure is
   * main having a commit develop does not, which turns the merge into a merge
   * commit or a conflict - so it is checked here, before the version commit
   * exists. Otherwise a failed merge would leave a bumped package.json on
   * develop with no tag, and the next run would skip that version number.
   */
  if (!succeeds("git", ["merge-base", "--is-ancestor", `origin/${TARGET_BRANCH}`, "HEAD"])) {
    fail(
      `origin/${TARGET_BRANCH} has commits that ${SOURCE_BRANCH} does not, so this ` +
        `cannot fast-forward.\nMerge ${TARGET_BRANCH} into ${SOURCE_BRANCH} first, ` +
        `then run this again.`,
    );
  }

  // The build type-checks the pages and the Worker first: the project's gate, and main is production.
  console.log("Running the build...");
  run("npm", ["run", "build"]);

  /*
   * The highest of package.json and the release tags is the base, so a tag
   * pushed from elsewhere is never overwritten and a hand-edited version is
   * never walked backwards.
   */
  const packageJsonPath = path.join(REPO_ROOT, "package.json");
  const packageVersion = parseVersion(JSON.parse(fs.readFileSync(packageJsonPath, "utf8")).version);
  const taggedVersions = capture("git", ["tag", "--list", "v[0-9]*.[0-9]*.[0-9]*"])
    .split("\n")
    .filter((tag) => /^v\d+\.\d+\.\d+$/.test(tag))
    .map((tag) => parseVersion(tag.slice(1)));

  const base = taggedVersions.reduce(
    (latest, candidate) => (compareVersions(candidate, latest) > 0 ? candidate : latest),
    packageVersion,
  );
  const newVersion = bumpVersion(base, bumpType).join(".");
  const tagName = `v${newVersion}`;

  if (succeeds("git", ["show-ref", "--verify", "--quiet", `refs/tags/${tagName}`])) {
    fail(`Tag ${tagName} already exists locally.`);
  }
  if (succeeds("git", ["ls-remote", "--exit-code", "--tags", "origin", `refs/tags/${tagName}`])) {
    fail(`Tag ${tagName} already exists on origin.`);
  }

  console.log(`Releasing ${newVersion} (${bumpType})...`);
  run("npm", ["version", newVersion, "--no-git-tag-version"]);

  const filesToAdd = ["package.json"];
  if (fs.existsSync("package-lock.json") && capture("git", ["diff", "--name-only", "--", "package-lock.json"])) {
    filesToAdd.push("package-lock.json");
  }

  run("git", ["add", "--", ...filesToAdd]);
  // Not a conventional-commit type on purpose: the log here is all feat and
  // fix, and a release is neither.
  run("git", ["commit", "-m", `Release: ${newVersion}`]);
  run("git", ["push", "origin", SOURCE_BRANCH]);

  console.log(`Fast-forwarding ${TARGET_BRANCH}...`);
  leftSourceBranch = true;
  if (succeeds("git", ["show-ref", "--verify", "--quiet", `refs/heads/${TARGET_BRANCH}`])) {
    run("git", ["switch", TARGET_BRANCH]);
    run("git", ["pull", "--ff-only", "origin", TARGET_BRANCH]);
  } else {
    run("git", ["switch", "-c", TARGET_BRANCH, `origin/${TARGET_BRANCH}`]);
  }

  run("git", ["merge", "--ff-only", SOURCE_BRANCH]);
  run("git", ["push", "origin", TARGET_BRANCH]);

  // Tagged on main, so the tag names the commit production actually serves.
  run("git", ["tag", "-a", tagName, "-m", `Release ${newVersion}`]);
  run("git", ["push", "origin", tagName]);

  console.log(`\nReleased ${newVersion}. ${TARGET_BRANCH} is pushed and ${tagName} is on origin.`);
} catch (error) {
  console.error(`\n${error.message || error}`);
  process.exitCode = 1;
} finally {
  // Guarded, so a failure to clean up cannot replace the error that caused it.
  try {
    if (leftSourceBranch && capture("git", ["rev-parse", "--abbrev-ref", "HEAD"]) !== SOURCE_BRANCH) {
      // A conflicted merge holds the checkout hostage and nothing here can
      // resolve it, so clear it before going back.
      if (fs.existsSync(path.join(capture("git", ["rev-parse", "--git-dir"]), "MERGE_HEAD"))) {
        run("git", ["merge", "--abort"]);
      }
      console.log(`Returning to ${SOURCE_BRANCH}...`);
      run("git", ["switch", SOURCE_BRANCH]);
    }
  } catch {
    console.error(`Could not get back to ${SOURCE_BRANCH}. Check "git status".`);
    process.exitCode = 1;
  }
}
