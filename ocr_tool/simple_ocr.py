#!/usr/bin/env python3
"""
Simple OCR Tool using OCRmyPDF
Replaces a non-OCR PDF with a searchable PDF version
"""

import os
import sys
import tempfile
import ocrmypdf
from ocrmypdf.exceptions import PriorOcrFoundError, EncryptedPdfError


def make_pdf_searchable(pdf_path, language='eng'):
    """
    Replace a non-OCR PDF with a searchable PDF version
    
    Args:
        pdf_path (str): Path to the input PDF file
        language (str): Language code for OCR (default: 'eng')
    
    Returns:
        bool: True if successful, False otherwise
    """
    try:
        print(f"Processing PDF: {pdf_path}")
        print(f"Language: {language}")
        
        # Create temporary file for processing
        with tempfile.NamedTemporaryFile(suffix='.pdf', delete=False) as temp_file:
            temp_pdf_path = temp_file.name
        
        # Perform OCR on the PDF
        ocrmypdf.ocr(
            pdf_path,
            temp_pdf_path,
            language=language,
            force_ocr=True,
            skip_text=False,
            output_type='pdf',
            progress_bar=True
        )
        
        # Replace original file with OCR'd version
        os.replace(temp_pdf_path, pdf_path)
        
        print(f"✓ PDF successfully converted to searchable: {pdf_path}")
        return True
        
    except PriorOcrFoundError:
        print("Error: PDF already contains OCR text.")
        return False
    except EncryptedPdfError:
        print("Error: PDF is encrypted. Please decrypt first.")
        return False
    except Exception as e:
        print(f"Error processing PDF: {str(e)}")
        return False


def main():
    if len(sys.argv) < 2:
        print("Usage: python simple_ocr.py <pdf_file> [language]")
        print("Example: python simple_ocr.py document.pdf")
        print("Example: python simple_ocr.py document.pdf fra")
        sys.exit(1)
    
    pdf_path = sys.argv[1]
    language = sys.argv[2] if len(sys.argv) > 2 else 'eng'
    
    # Validate input file
    if not os.path.exists(pdf_path):
        print(f"Error: File '{pdf_path}' does not exist.")
        sys.exit(1)
    
    if not pdf_path.lower().endswith('.pdf'):
        print("Error: File must be a PDF.")
        sys.exit(1)
    
    # Make PDF searchable
    success = make_pdf_searchable(pdf_path, language)
    
    if not success:
        sys.exit(1)


if __name__ == "__main__":
    main()
