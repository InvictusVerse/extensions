import os
import json
import subprocess

# --- CONFIGURATION ---
GITHUB_USERNAME = "InvictusVerse"
GITHUB_REPO = "extensions"
# ---------------------

def build_plugins():
    build_dir = "builds"
    os.makedirs(build_dir, exist_ok=True)
    
    plugins_list = []
    print("🚀 Starting fast JS plugin build process...")
    
    # We use npx to run esbuild (Ensure you have Node.js installed on your PC)
    for folder in os.listdir("."):
        if os.path.isdir(folder) and folder not in [".git", ".github", "builds", "node_modules"]:
            manifest_path = os.path.join(folder, "manifest.json")
            
            if os.path.exists(manifest_path):
                with open(manifest_path, "r", encoding="utf-8") as f:
                    manifest = json.load(f)
                
                # Use ID or folder name for the filename
                plugin_id = manifest.get("id", folder)
                plugin_name = manifest.get("name", folder)
                
                # Get entry file (fallback to main.js if not specified)
                entry_file = manifest.get("main", "main.js")
                entry_path = os.path.join(folder, entry_file)
                
                if not os.path.exists(entry_path):
                    print(f"⚠️ Warning: Entry file {entry_path} not found for {plugin_name}. Skipping.")
                    continue

                bundle_filename = f"{plugin_id}.bundle.js"
                bundle_filepath = os.path.join(build_dir, bundle_filename)
                
                print(f"📦 Bundling and minifying {plugin_name}...")
                try:
                    # Run esbuild to squash everything into one file
                    subprocess.run([
                        "npx", "esbuild", entry_path, 
                        "--bundle", 
                        "--minify", 
                        f"--outfile={bundle_filepath}",
                        "--platform=node", # Preserves built-in node modules like 'crypto'
                        "--format=cjs"     # Uses CommonJS (module.exports)
                    ], check=True, shell=True) # shell=True helps Windows find npx
                except Exception as e:
                    print(f"❌ Failed to build {plugin_name}: {e}")
                    continue
                
                # Update manifest URL to point directly to the bundled JS file on GitHub
                manifest["url"] = f"https://raw.githubusercontent.com/{GITHUB_USERNAME}/{GITHUB_REPO}/builds/{bundle_filename}"
                
                # Clean up local-only keys for the production JSON
                if "main" in manifest:
                    del manifest["main"]

                plugins_list.append(manifest)
                print(f"✅ Successfully built: {plugin_name}")

    with open(os.path.join(build_dir, "plugins.json"), "w", encoding="utf-8") as f:
        json.dump(plugins_list, f, indent=4)
    print("✅ Master plugins.json generated successfully.")

if __name__ == "__main__":
    build_plugins()