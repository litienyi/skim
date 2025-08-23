# Folder Import Feature for Skim2

## Overview

The folder import feature allows users to import multiple PDF files from an external folder into the Skim2 application without having to upload them one by one. This is particularly useful when you have a large collection of PDFs that you want to analyze.

## Features

### 1. Folder Scanning
- Scan any folder on your system for PDF files
- View file information including size and count
- Real-time folder scanning with progress indicators

### 2. Selective Import
- Choose which PDF files to import from the scanned folder
- Select all or deselect all files with one click
- Skip files that already exist in your library

### 3. Batch Processing
- Import multiple files simultaneously
- Progress tracking during import
- Detailed import results with success/failure information

### 4. Folder Management
- View current upload folder configuration
- Reset to default folder (backend/uploads) when needed
- Maintains original file organization

## How to Use

### Step 1: Access the Feature
1. Click the "Import from folder" button in the application header
2. This opens the folder import modal

### Step 2: Enter Folder Path
1. Enter the full path to your PDF folder
   - Example: `/Users/username/Documents/PDFs`
   - Example: `C:\Users\username\Documents\PDFs` (Windows)
2. Click "Scan Folder" to find all PDF files

### Step 3: Select Files
1. Review the list of found PDF files
2. Check the boxes next to files you want to import
3. Use "Select All" or "Deselect All" for bulk operations
4. Files already in your library will be automatically skipped

### Step 4: Import
1. Click "Import Selected Files" to start the import process
2. Wait for the import to complete
3. Review the import results
4. Your imported files will appear in the main document list

## Technical Details

### Backend Endpoints

#### `POST /api/folder/scan`
Scans a folder for PDF files and returns file information.

**Request:**
```json
{
  "folder_path": "/path/to/your/folder"
}
```

**Response:**
```json
{
  "folder_path": "/path/to/your/folder",
  "pdf_files": [
    {
      "filename": "document.pdf",
      "file_path": "/path/to/your/folder/document.pdf",
      "file_size": 1048576,
      "file_size_mb": 1.0
    }
  ],
  "count": 1
}
```

#### `POST /api/folder/import`
Imports selected PDF files from a folder.

**Request:**
```json
{
  "folder_path": "/path/to/your/folder",
  "selected_files": ["document1.pdf", "document2.pdf"]
}
```

**Response:**
```json
{
  "message": "Import completed. 2 files imported successfully.",
  "imported_documents": [
    {
      "id": "uuid",
      "filename": "document1.pdf",
      "num_pages": 10,
      "file_size": 1048576
    }
  ],
  "failed_imports": [],
  "total_selected": 2,
  "successful": 2,
  "failed": 0
}
```

#### `GET /api/folder/config`
Returns current folder configuration.

**Response:**
```json
{
  "current_upload_folder": "/path/to/current/folder",
  "default_upload_folder": "/path/to/default/folder",
  "is_default": true
}
```

#### `POST /api/folder/reset`
Resets the upload folder to default.

**Response:**
```json
{
  "message": "Upload folder reset to default successfully",
  "current_upload_folder": "/path/to/default/folder",
  "is_default": true
}
```

### File Processing

1. **File Validation**: Only PDF files are accepted
2. **Duplicate Detection**: Files with the same original filename are skipped
3. **Safe Copying**: Files are copied to the application's upload folder with unique IDs
4. **Text Extraction**: PDF text is extracted and stored in the database
5. **Database Integration**: Imported files are added to the document library

### Security Considerations

- Only PDF files are processed
- File paths are validated and sanitized
- Files are copied to the application's controlled upload directory
- Original files remain untouched in their source location

## Error Handling

The feature includes comprehensive error handling:

- **Invalid folder paths**: Clear error messages for non-existent or inaccessible folders
- **File access issues**: Graceful handling of permission problems
- **Import failures**: Detailed reporting of which files failed and why
- **Duplicate files**: Automatic skipping with user notification

## Limitations

- Only PDF files are supported
- Files must be accessible by the application
- Large folders may take time to scan
- Import speed depends on file sizes and system performance

## Troubleshooting

### Common Issues

1. **"Folder does not exist"**
   - Verify the folder path is correct
   - Ensure the path uses proper separators for your OS

2. **"Permission denied"**
   - Check file and folder permissions
   - Ensure the application has read access to the folder

3. **"File already exists"**
   - This is normal behavior - duplicate files are automatically skipped
   - Check the import results for details

4. **Import takes too long**
   - Large files or many files may take time to process
   - Check the progress indicators and wait for completion

### Performance Tips

- Import files in smaller batches for better performance
- Ensure sufficient disk space for file copying
- Close other applications to free up system resources

## Future Enhancements

Potential improvements for future versions:

- Drag and drop folder selection
- Recursive folder scanning (subfolders)
- File filtering by size or date
- Import progress with individual file status
- Background import processing
- Import scheduling

