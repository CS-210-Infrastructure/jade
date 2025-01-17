import os
import sys
import shutil

def convert_json_to_js(json_file):
    try:
        if not os.path.isfile(json_file):
            raise FileNotFoundError(f"File '{json_file}' not found.")
        js_file = os.path.splitext(json_file)[0] + ".js"
        shutil.copyfile(json_file, js_file)
        print(f"Successfully copied '{json_file}' to '{js_file}'.")

    except Exception as e:
        print(f"Error converting file: {e}")

if len(sys.argv) != 2:
    print("Usage: python3 converter.py myJsonFile.json")
    sys.exit(1)

json_file = sys.argv[1]
convert_json_to_js(json_file)
