import json

# Load the old file
with open("skim2_spreadsheet (1).json", "r", encoding="utf-8") as f:
    data = json.load(f)

# Convert each cell: if 'result' exists and 'value' is empty, set 'value' = 'result'
for row in data["rows"]:
    for cell in row:
        if "result" in cell:
            if not cell.get("value") and cell.get("result"):
                cell["value"] = cell["result"]
            # Remove the 'result' field
            del cell["result"]

# Save to a new file
with open("skim2_spreadsheet_converted.json", "w", encoding="utf-8") as f:
    json.dump(data, f, ensure_ascii=False, indent=2)

print("Conversion complete! Saved as skim2_spreadsheet_converted.json")