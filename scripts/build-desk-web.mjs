import fs from "node:fs";
import path from "node:path";
import {createHash} from "node:crypto";
import {execFileSync, spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const pnpm=process.env.npm_execpath;
if(!pnpm||process.env.PHOENIX_WING_MODE!=="registry")throw new Error("Use pnpm build:browser-host with Registry Wing");
if(process.version!=="v22.23.1")throw new Error("The source browser-host pilot requires exact Node v22.23.1");
function run(args){const result=spawnSync(process.execPath,args,{cwd:root,env:{...process.env,VITE_API_ORIGIN:"",VITE_DESK_API_SOURCE:"browser-service"},stdio:"inherit"});if(result.status!==0)throw new Error("Browser-host build failed");}
run([pnpm,"-C","web-ui","build"]);
run([path.join(root,"server/scripts/build-server-bundle.mjs"),"--browser"]);
const sha=data=>createHash("sha256").update(data).digest("hex");
const files=[];
function member(rel){const filename=path.join(root,rel),stat=fs.lstatSync(filename);if(!stat.isFile()||stat.isSymbolicLink())throw new Error("Non-regular runtime member");files.push({path:rel,bytes:stat.size,sha256:sha(fs.readFileSync(filename))});}
function tree(rel){for(const item of fs.readdirSync(path.join(root,rel),{withFileTypes:true})){if(item.isSymbolicLink()||item.name.startsWith("."))throw new Error("Unsafe Web build member");const file=rel+"/"+item.name;if(item.isDirectory())tree(file);else member(file);}}
member("server/dist-browser/server.mjs");tree("web-ui/dist");
member("phoenix/config/app_config.json");member("phoenix/config/test_fixture_catalog.json");
files.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
const payload={kind:"phoenix.desk.browser-host",schema_version:1,status:"not-published",app_version:JSON.parse(fs.readFileSync(path.join(root,"package.json"),"utf8")).version,
  service_protocol_version:1,browser_host_protocol:1,profile:"browser-service-v1",entry:"server/dist-browser/server.mjs",web_root:"web-ui/dist",
  node:{version:process.version,bundled:false,sha256:sha(fs.readFileSync(process.execPath))},platform:process.platform,arch:process.arch,
  source:{commit:execFileSync("git",["rev-parse","HEAD"],{cwd:root,encoding:"utf8"}).trim(),dirty:!!execFileSync("git",["status","--porcelain"],{cwd:root,encoding:"utf8"}).trim()},files,assets:[]};
const manifest={...payload,runtime_id:"sha256:"+sha(JSON.stringify(payload)),generated_at:new Date().toISOString()};
const output=path.join(root,"server/dist-browser/browser-host-manifest.json");
fs.writeFileSync(output,JSON.stringify(manifest,null,2)+"\n",{mode:0o600});
process.stdout.write(JSON.stringify({status:"candidate-built-not-published",runtime_id:manifest.runtime_id,files:files.length,platform:process.platform,arch:process.arch,node:process.version})+"\n");
