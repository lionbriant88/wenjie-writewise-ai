#!/bin/sh
set -eu
# Run as root only after the exact artifact and its checksum are reviewed.
# This installs files/units; it does not migrate data, open ports, or start services.
[ "$(id -u)" = 0 ] || { echo root_required >&2; exit 1; }
release=${1:?release_directory_required}
case "$release" in /srv/writewise/staging/*) ;; *) echo invalid_release_directory >&2; exit 1;; esac
[ -d "$release" ] && [ ! -L "$release" ] || exit 1
name=$(basename "$release")
case "$name" in *[!a-zA-Z0-9_-]*|'') exit 1;; esac
[ "$(realpath "$release")" = "/srv/writewise/staging/$name" ] || exit 1
# An external trusted SHA-256 must have authenticated the copied archive before
# this script is executed. Self-manifest checks alone cannot authenticate code.
for protected in /srv /srv/writewise /srv/writewise/staging "$release"; do
  [ "$(stat -c %u "$protected")" = 0 ] || exit 1
  [ -z "$(find "$protected" -maxdepth 0 -perm /022 -print)" ] || exit 1
done
[ -z "$(find "$release" \( ! -user root -o -perm /022 \) -print -quit)" ] || exit 1
node=$(command -v node)
[ "$($node -p 'process.versions.node.split(".")[0]')" = 24 ] || { echo node24_required >&2; exit 1; }
"$node" --input-type=module - "$release" <<'NODE'
import {readFile,lstat,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';import {join,resolve,sep} from 'node:path';
const root=resolve(process.argv[2]),manifest=JSON.parse(await readFile(join(root,'release-manifest.json'),'utf8'));
const names=new Set(['release-manifest.json']);
for(const entry of manifest.files){
 const path=resolve(root,entry.path);if(!path.startsWith(root+sep)||names.has(entry.path))throw Error('invalid_manifest');
 names.add(entry.path);const info=await lstat(path);if(!info.isFile()||info.isSymbolicLink())throw Error('unsafe_artifact');
 const bytes=await readFile(path);if(bytes.length!==entry.bytes||createHash('sha256').update(bytes).digest('hex')!==entry.sha256)throw Error('artifact_mismatch');
}
async function walk(dir,prefix=''){for(const e of await readdir(dir,{withFileTypes:true})){if(e.isSymbolicLink())throw Error('artifact_symlink');const name=prefix+e.name;if(e.isDirectory())await walk(join(dir,e.name),name+'/');else if(!names.has(name))throw Error('unlisted_artifact');}}
await walk(root);
NODE
id wj-app >/dev/null 2>&1 || useradd --system --home-dir /var/lib/writewise --shell /usr/sbin/nologin wj-app
install -d -o root -g root -m 0755 /srv/writewise/releases
[ ! -e "/srv/writewise/releases/$name" ] || { echo release_already_exists >&2; exit 1; }
cp -R -- "$release" "/srv/writewise/releases/$name"
chown -R root:root "/srv/writewise/releases/$name"
chmod -R go-w "/srv/writewise/releases/$name"
install -d -o root -g wj-app -m 0750 /etc/writewise
install -d -o wj-app -g wj-app -m 0700 /var/lib/writewise /var/lib/writewise/originals /var/lib/writewise/run
if [ ! -e /etc/writewise/runtime.env ]; then
  install -o root -g wj-app -m 0640 "$release/deploy/tencent/runtime.env.example" /etc/writewise/runtime.env
fi
for unit in writewise-api.service writewise-worker.service writewise-maintenance.service; do
  sed "s|@NODE@|$node|g" "$release/deploy/tencent/$unit" > "/etc/systemd/system/$unit"
  chmod 0644 "/etc/systemd/system/$unit"
done
install -m 0644 "$release/deploy/tencent/writewise-maintenance.timer" /etc/systemd/system/writewise-maintenance.timer
systemctl daemon-reload
echo "release_installed_services_not_started $name"
# Choosing /srv/writewise/current and starting any service is an explicit later step.
