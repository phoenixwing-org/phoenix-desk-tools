import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifestFiles = ["package.json", "server/package.json", "web-ui/package.json"];
const dependencySections = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
];
const expectedWingVersions = {
  "phoenix-wing": "0.8.1",
  "@phoenix-wing/code-core": "0.6.8",
  "@phoenix-wing/git-node": "0.6.5",
  "@phoenix-wing/cad-core": "0.7.0",
  "@phoenix-wing/cad-contracts": "0.7.0",
  "@phoenix-wing/db-node": "0.6.3",
  "@phoenix-wing/workspace-schema": "0.6.3",
};
const wingDependencies = new Map();

for (const relative of manifestFiles) {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, relative), "utf8"));
  for (const section of dependencySections) {
    for (const [name, specifier] of Object.entries(manifest[section] ?? {})) {
      if (name !== "phoenix-wing" && !name.startsWith("@phoenix-wing/")) continue;
      if (!/^\d+\.\d+\.\d+$/u.test(specifier)) {
        throw new Error(`${relative} ${section}.${name} must use an exact Registry version, got ${specifier}`);
      }
      const expectedVersion = expectedWingVersions[name];
      if (!expectedVersion) {
        throw new Error(`${relative} declares Wing package without a release-matrix version: ${name}`);
      }
      if (specifier !== expectedVersion) {
        throw new Error(
          `${relative} ${section}.${name} must use Registry ${expectedVersion}, got ${specifier}`,
        );
      }
      const existing = wingDependencies.get(name);
      if (existing && existing.specifier !== specifier) {
        throw new Error(
          `${name} must use one exact version across manifests, got ${existing.specifier} and ${specifier}`,
        );
      }
      wingDependencies.set(name, { name, specifier });
    }
  }
  for (const [name, target] of Object.entries(manifest.pnpm?.overrides ?? {})) {
    if (name.includes("phoenix-wing") || String(target).includes("phoenix-wing")) {
      throw new Error(`${relative} must not override Wing through ${name}: ${target}`);
    }
  }
}

if (wingDependencies.size === 0) throw new Error("No Wing dependencies were found");
const lockfile = fs.readFileSync(path.join(root, "pnpm-lock.yaml"), "utf8");
if (/(?:link|file):[^\n]*phoenix-wing/iu.test(lockfile)) {
  throw new Error("pnpm-lock.yaml must not resolve Wing from a local path");
}
for (const { name, specifier } of wingDependencies.values()) {
  if (!lockfile.includes(`'${name}@${specifier}':`) && !lockfile.includes(`  ${name}@${specifier}:`)) {
    throw new Error(`pnpm-lock.yaml is missing Registry resolution ${name}@${specifier}`);
  }
}

process.stdout.write(
  `[verify] ${wingDependencies.size} Wing packages use their exact Registry release-matrix versions with no local overrides\n`,
);
