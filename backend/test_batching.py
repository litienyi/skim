#!/usr/bin/env python3
"""
Test script for batching functionality
Tests various page range formats and API responses
"""

import json
import requests
import time
from app import parse_page_ranges

# Test configuration
API_URL = "http://localhost:5001/api"
TEST_DOCUMENT_ID = 3  # Update this to match your document ID

def test_parse_page_ranges():
    """Test the parse_page_ranges function with various inputs"""
    print("=== TESTING PARSE_PAGE_RANGES FUNCTION ===")
    
    test_cases = [
        # Basic ranges
        ("1-50;51-98", "Basic semicolon-separated ranges"),
        ("1-10;20-30;40-50", "Multiple ranges with gaps"),
        ("1-5", "Single range"),
        ("5", "Single page"),
        
        # Square bracket grouping
        ("11-17;18-54;55-95;[96-98;131-157];158-222", "Mixed with bracket group"),
        ("[1-5;10-15;20-25]", "All pages in brackets"),
        ("1-10;[11-20;30-40];41-50", "Mixed format"),
        ("[1-3;5-7;9-11]", "Multiple ranges in brackets"),
        
        # Edge cases
        ("", "Empty string"),
        ("1-5;6-10", "Consecutive ranges"),
        ("5;10;15", "Individual pages"),
        ("[1-3;5-7]", "Bracket with gaps"),
    ]
    
    for input_str, description in test_cases:
        print(f"\n--- {description} ---")
        print(f"Input: '{input_str}'")
        try:
            result = parse_page_ranges(input_str)
            print(f"Result: {result}")
            print(f"Number of batches: {len(result)}")
            for i, batch in enumerate(result):
                print(f"  Batch {i+1}: {len(batch)} pages ({batch[0]}-{batch[-1] if batch else 'N/A'})")
        except Exception as e:
            print(f"Error: {e}")

def test_api_batching():
    """Test the API batching functionality"""
    print("\n=== TESTING API BATCHING ===")
    
    test_cases = [
        {
            "name": "Single Range",
            "page_range": "1-10",
            "message": "What is the main topic of these pages?"
        },
        {
            "name": "Multiple Ranges",
            "page_range": "1-5;6-10",
            "message": "Summarize the content across these page ranges."
        },
        {
            "name": "Bracket Grouping",
            "page_range": "[1-3;5-7]",
            "message": "What are the key points from these selected pages?"
        },
        {
            "name": "Mixed Format",
            "page_range": "1-5;[6-8;10-12];15-20",
            "message": "Analyze the content from these different sections."
        },
        {
            "name": "Large Range",
            "page_range": "1-50;51-100",
            "message": "Provide a comprehensive overview of this material."
        }
    ]
    
    for test_case in test_cases:
        print(f"\n--- {test_case['name']} ---")
        print(f"Page Range: {test_case['page_range']}")
        print(f"Message: {test_case['message']}")
        
        # Prepare request
        request_data = {
            "document_id": TEST_DOCUMENT_ID,
            "message": test_case['message'],
            "page_range": test_case['page_range']
        }
        
        print(f"Request: {json.dumps(request_data, indent=2)}")
        
        try:
            # Make API call
            start_time = time.time()
            response = requests.post(
                f"{API_URL}/chat",
                json=request_data,
                headers={'Content-Type': 'application/json'}
            )
            end_time = time.time()
            
            print(f"Response Status: {response.status_code}")
            print(f"Response Time: {end_time - start_time:.2f} seconds")
            
            if response.status_code == 200:
                data = response.json()
                print(f"Response Type: {type(data)}")
                
                if 'batches' in data:
                    print(f"Number of batches: {len(data['batches'])}")
                    for i, batch in enumerate(data['batches']):
                        print(f"  Batch {i+1}:")
                        print(f"    Pages: {batch.get('pages', 'N/A')}")
                        print(f"    Answer length: {len(batch.get('response', {}).get('answer', ''))}")
                        print(f"    References: {len(batch.get('response', {}).get('references', []))}")
                else:
                    print("No batches found in response")
                    print(f"Response keys: {list(data.keys()) if isinstance(data, dict) else 'Not a dict'}")
            else:
                print(f"Error: {response.text}")
                
        except Exception as e:
            print(f"Request failed: {e}")
        
        # Add delay between tests to avoid rate limiting
        time.sleep(2)

def test_error_handling():
    """Test error handling for invalid inputs"""
    print("\n=== TESTING ERROR HANDLING ===")
    
    error_cases = [
        ("invalid", "Invalid page number"),
        ("1-abc", "Invalid range format"),
        ("[1-5;invalid]", "Invalid content in brackets"),
        ("1-5;6-abc", "Mixed valid and invalid"),
        ("[1-5", "Unclosed bracket"),
        ("1-5]", "Unopened bracket"),
    ]
    
    for input_str, description in error_cases:
        print(f"\n--- {description} ---")
        print(f"Input: '{input_str}'")
        try:
            result = parse_page_ranges(input_str)
            print(f"Result: {result}")
        except Exception as e:
            print(f"Error: {e}")

def test_performance():
    """Test performance with large page ranges"""
    print("\n=== TESTING PERFORMANCE ===")
    
    # Test with a large number of pages
    large_range = "1-50;51-100;101-150;151-200"
    print(f"Testing with large range: {large_range}")
    
    try:
        batches = parse_page_ranges(large_range)
        print(f"Parsed into {len(batches)} batches")
        total_pages = sum(len(batch) for batch in batches)
        print(f"Total pages: {total_pages}")
        
        # Test API call with large range
        request_data = {
            "document_id": TEST_DOCUMENT_ID,
            "message": "Provide a comprehensive analysis of this large document section.",
            "page_range": large_range
        }
        
        print("Making API call with large range...")
        start_time = time.time()
        response = requests.post(
            f"{API_URL}/chat",
            json=request_data,
            headers={'Content-Type': 'application/json'}
        )
        end_time = time.time()
        
        print(f"Response Status: {response.status_code}")
        print(f"Total Time: {end_time - start_time:.2f} seconds")
        
        if response.status_code == 200:
            data = response.json()
            if 'batches' in data:
                print(f"Successfully processed {len(data['batches'])} batches")
                for i, batch in enumerate(data['batches']):
                    print(f"  Batch {i+1}: {batch.get('pages', 'N/A')} - {len(batch.get('response', {}).get('answer', ''))} chars")
        
    except Exception as e:
        print(f"Performance test failed: {e}")

def main():
    """Run all tests"""
    print("🚀 STARTING BATCHING FUNCTIONALITY TESTS")
    print("=" * 50)
    
    # Test the parsing function
    test_parse_page_ranges()
    
    # Test API batching
    test_api_batching()
    
    # Test error handling
    test_error_handling()
    
    # Test performance
    test_performance()
    
    print("\n" + "=" * 50)
    print("✅ ALL TESTS COMPLETED")

if __name__ == "__main__":
    main() 