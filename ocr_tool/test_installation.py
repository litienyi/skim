#!/usr/bin/env python3
"""
Test script to verify OCR tool installation
"""

import sys
import subprocess

def test_imports():
    """Test if required Python packages can be imported"""
    print("Testing Python package imports...")
    
    try:
        import ocrmypdf
        print("✓ ocrmypdf imported successfully")
    except ImportError as e:
        print(f"✗ Failed to import ocrmypdf: {e}")
        return False
    
    try:
        from PIL import Image
        print("✓ Pillow imported successfully")
    except ImportError as e:
        print(f"✗ Failed to import Pillow: {e}")
        return False
    
    return True

def test_tesseract():
    """Test if Tesseract OCR is installed and accessible"""
    print("\nTesting Tesseract OCR installation...")
    
    try:
        result = subprocess.run(['tesseract', '--version'], 
                              capture_output=True, text=True, timeout=10)
        if result.returncode == 0:
            print("✓ Tesseract OCR is installed and accessible")
            # Extract version info
            version_line = result.stdout.split('\n')[0]
            print(f"  Version: {version_line}")
            return True
        else:
            print("✗ Tesseract OCR command failed")
            return False
    except FileNotFoundError:
        print("✗ Tesseract OCR not found in system PATH")
        print("  Please install Tesseract OCR:")
        print("  - macOS: brew install tesseract")
        print("  - Ubuntu: sudo apt-get install tesseract-ocr")
        print("  - Windows: Download from https://github.com/UB-Mannheim/tesseract/wiki")
        return False
    except subprocess.TimeoutExpired:
        print("✗ Tesseract OCR command timed out")
        return False

def test_pdftotext():
    """Test if pdftotext is available (optional)"""
    print("\nTesting pdftotext availability...")
    
    try:
        result = subprocess.run(['pdftotext', '-v'], 
                              capture_output=True, text=True, timeout=10)
        if result.returncode == 0:
            print("✓ pdftotext is available")
            return True
        else:
            print("⚠ pdftotext command failed (optional dependency)")
            return False
    except FileNotFoundError:
        print("⚠ pdftotext not found (optional dependency)")
        print("  For better text extraction, install poppler-utils:")
        print("  - macOS: brew install poppler")
        print("  - Ubuntu: sudo apt-get install poppler-utils")
        return False

def main():
    print("OCR Tool Installation Test")
    print("=" * 40)
    
    all_tests_passed = True
    
    # Test Python imports
    if not test_imports():
        all_tests_passed = False
    
    # Test Tesseract OCR
    if not test_tesseract():
        all_tests_passed = False
    
    # Test pdftotext (optional)
    test_pdftotext()
    
    print("\n" + "=" * 40)
    if all_tests_passed:
        print("✓ All required dependencies are installed!")
        print("You can now use the OCR tool:")
        print("  python simple_ocr.py --help")
    else:
        print("✗ Some required dependencies are missing.")
        print("Please install the missing dependencies and run this test again.")
        sys.exit(1)

if __name__ == "__main__":
    main()
