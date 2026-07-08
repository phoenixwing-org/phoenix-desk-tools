//! fcstd-xlink CLI — XLink 修改命令行
use std::collections::HashMap;
use std::path::PathBuf;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() < 3 {
        eprintln!("fcstd-xlink <command> <args>");
        eprintln!("  patch <file.fcstd> <old_attr>=<new_attr> ...");
        eprintln!("  scan <xml_file|-> <target_basename>");
        std::process::exit(1);
    }
    match args[1].as_str() {
        "patch" => {
            let path = PathBuf::from(&args[2]);
            let mut reps = HashMap::new();
            for a in &args[3..] {
                if let Some((k, v)) = a.split_once('=') { reps.insert(k.to_string(), v.to_string()); }
            }
            match fcstd_xlink::patch_fcstd_xlink_attrs(&path, &reps) {
                Ok(n) => println!(r#"{{"ok":true,"count":{}}}"#, n),
                Err(e) => { eprintln!("Error: {e}"); std::process::exit(1); }
            }
        }
        "scan" => {
            let xml = if args[2] == "-" {
                std::io::read_to_string(std::io::stdin()).unwrap()
            } else {
                std::fs::read_to_string(&args[2]).unwrap()
            };
            let hits = fcstd_xlink::scan_xlink_hits(&xml, &args[3]);
            println!("{}", serde_json::to_string(&hits).unwrap());
        }
        _ => { eprintln!("Unknown command"); std::process::exit(1); }
    }
}
