# Simple OCR Tool

A simple command-line OCR tool that replaces non-OCR PDF files with searchable PDF versions using OCRmyPDF.

## Features

- Convert non-OCR PDFs to searchable PDFs
- Replace original file with searchable version
- Support for multiple languages
- Simple command-line interface with progress bars

## Installation

### Prerequisites

1. **Python 3.7+** - Make sure you have Python installed
2. **Tesseract OCR** - Required for OCRmyPDF to work

#### Installing Tesseract OCR

**macOS:**
```bash
brew install tesseract
```

**Ubuntu/Debian:**
```bash
sudo apt-get install tesseract-ocr
```

**Windows:**
Download and install from: https://github.com/UB-Mannheim/tesseract/wiki

### Install Python Dependencies

1. Navigate to the `ocr_tool` directory:
```bash
cd ocr_tool
```

2. Create a virtual environment (recommended):
```bash
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
```

3. Install dependencies:
```bash
pip install -r requirements.txt
```

## Usage

### Basic Usage

Convert a PDF to searchable and replace the original:
```bash
python simple_ocr.py document.pdf
```

### Different Language

```bash
python simple_ocr.py document.pdf fra  # French
python simple_ocr.py document.pdf deu  # German
python simple_ocr.py document.pdf spa  # Spanish
```

## Command Line Syntax

```
python simple_ocr.py <pdf_file> [language]
```

- `pdf_file`: Path to the PDF file to convert
- `language`: Optional language code (default: eng)

## Supported Languages

The tool supports all languages that Tesseract OCR supports. Common language codes:

- `eng` - English (default)
- `fra` - French
- `deu` - German
- `spa` - Spanish
- `ita` - Italian
- `por` - Portuguese
- `rus` - Russian
- `chi_sim` - Simplified Chinese
- `jpn` - Japanese
- `kor` - Korean

## Examples

### Convert a scanned document:
```bash
python simple_ocr.py scanned_document.pdf
```

### Convert a French document:
```bash
python simple_ocr.py french_document.pdf fra
```

### Convert multiple documents:
```bash
python simple_ocr.py doc1.pdf
python simple_ocr.py doc2.pdf
python simple_ocr.py doc3.pdf
```

## What Happens

1. The tool processes the PDF using OCR
2. Creates a temporary searchable version
3. Replaces the original file with the searchable version
4. The original file is overwritten with the searchable PDF

## Troubleshooting

### Common Issues

1. **"Tesseract not found" error**
   - Make sure Tesseract OCR is installed and in your system PATH
   - On macOS: `brew install tesseract`
   - On Ubuntu: `sudo apt-get install tesseract-ocr`

2. **"PDF is encrypted" error**
   - The PDF file is password-protected
   - Decrypt the PDF first before running OCR

3. **"PDF already contains OCR text" error**
   - The PDF already has OCR text embedded
   - The tool won't process it to avoid overwriting existing OCR

4. **Poor OCR quality**
   - Ensure the PDF has good image quality
   - Try different language settings
   - Make sure the text is clearly readable in the original

### Performance Tips

- For large PDFs, processing may take several minutes
- Ensure you have sufficient disk space for temporary files
- Close other applications to free up memory

## Test Installation

Run the test script to verify everything is working:
```bash
python test_installation.py
```

## License

This tool is provided as-is for educational and personal use.

## Dependencies

- `ocrmypdf` - PDF OCR processing
- `Pillow` - Image processing
- `Tesseract OCR` - OCR engine (system dependency)
