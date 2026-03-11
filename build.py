import os
import json
import zipfile

# --- CONFIGURATION ---
GITHUB_USERNAME = "InvictusVerse"
GITHUB_REPO = "extensions"
# ---------------------

def build_plugins():
    build_dir = "builds"
    os.makedirs(build_dir, exist_ok=True)
    
    plugins_list = []
    print("🚀 Starting plugin build process...")
    
    for folder in os.listdir("."):
        if os.path.isdir(folder) and folder not in [".git", ".github", "builds"]:
            manifest_path = os.path.join(folder, "manifest.json")
            
            if os.path.exists(manifest_path):
                with open(manifest_path, "r", encoding="utf-8") as f:
                    manifest = json.load(f)
                
                plugin_name = manifest.get("internalName", folder)
                zip_filename = f"{plugin_name}.plugin"
                zip_filepath = os.path.join(build_dir, zip_filename)
                
                with zipfile.ZipFile(zip_filepath, 'w', zipfile.ZIP_DEFLATED) as plugin_zip:
                    for root, _, files in os.walk(folder):
                        for file in files:
                            file_path = os.path.join(root, file)
                            arcname = os.path.relpath(file_path, folder)
                            plugin_zip.write(file_path, arcname)
                
                manifest["url"] = f"https://raw.githubusercontent.com/{GITHUB_USERNAME}/{GITHUB_REPO}/builds/{zip_filename}"
                plugins_list.append(manifest)
                print(f"✅ Built: {plugin_name}")

    with open(os.path.join(build_dir, "plugins.json"), "w", encoding="utf-8") as f:
        json.dump(plugins_list, f, indent=4)
    print("✅ Master plugins.json generated.")

if __name__ == "__main__":
    build_plugins()
