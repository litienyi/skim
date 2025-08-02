#!/usr/bin/env python3
"""
Manual test script for batching functionality
Run this to test the batching with a simple example
"""

import requests
import json
import time

# Configuration
API_URL = "http://localhost:5001/api"
DOCUMENT_ID = 3  # Update this to match your document ID

def test_simple_batching():
    """Test simple batching functionality"""
    print("🧪 MANUAL BATCHING TEST")
    print("=" * 40)
    
    # Test case
    page_range = "1-5;6-10"
    message = "What are the main topics covered in these pages?"
    
    print(f"Testing with page range: {page_range}")
    print(f"Message: {message}")
    
    # Prepare request
    request_data = {
        "document_id": DOCUMENT_ID,
        "message": message,
        "page_range": page_range
    }
    
    print(f"\nSending request to: {API_URL}/chat")
    print(f"Request data: {json.dumps(request_data, indent=2)}")
    
    try:
        # Make API call
        print("\n⏳ Making API call...")
        start_time = time.time()
        
        response = requests.post(
            f"{API_URL}/chat",
            json=request_data,
            headers={'Content-Type': 'application/json'}
        )
        
        end_time = time.time()
        duration = end_time - start_time
        
        print(f"✅ Response received in {duration:.2f} seconds")
        print(f"Status Code: {response.status_code}")
        
        if response.status_code == 200:
            data = response.json()
            print(f"Response Type: {type(data)}")
            
            if 'batches' in data:
                print(f"\n🎉 SUCCESS! Found {len(data['batches'])} batches:")
                
                for i, batch in enumerate(data['batches']):
                    print(f"\n  📦 Batch {i+1}:")
                    print(f"     Pages: {batch.get('pages', 'N/A')}")
                    
                    response_data = batch.get('response', {})
                    answer = response_data.get('answer', '')
                    references = response_data.get('references', [])
                    
                    print(f"     Answer length: {len(answer)} characters")
                    print(f"     References: {len(references)}")
                    
                    if answer:
                        print(f"     Answer preview: {answer[:100]}...")
                    
                    if references:
                        print(f"     First reference: {references[0] if references else 'None'}")
                        
            else:
                print("❌ No 'batches' found in response")
                print(f"Response keys: {list(data.keys()) if isinstance(data, dict) else 'Not a dict'}")
                print(f"Full response: {json.dumps(data, indent=2)}")
        else:
            print(f"❌ Error: {response.text}")
            
    except requests.exceptions.ConnectionError:
        print("❌ Connection Error: Make sure the backend server is running on localhost:5001")
    except Exception as e:
        print(f"❌ Request failed: {e}")

def test_bracket_grouping():
    """Test bracket grouping functionality"""
    print("\n🎯 TESTING BRACKET GROUPING")
    print("=" * 40)
    
    # Test case with bracket grouping
    page_range = "[1-3;5-7]"
    message = "What are the key points from these selected pages?"
    
    print(f"Testing with page range: {page_range}")
    print(f"Message: {message}")
    
    # Prepare request
    request_data = {
        "document_id": DOCUMENT_ID,
        "message": message,
        "page_range": page_range
    }
    
    try:
        print("\n⏳ Making API call...")
        start_time = time.time()
        
        response = requests.post(
            f"{API_URL}/chat",
            json=request_data,
            headers={'Content-Type': 'application/json'}
        )
        
        end_time = time.time()
        duration = end_time - start_time
        
        print(f"✅ Response received in {duration:.2f} seconds")
        print(f"Status Code: {response.status_code}")
        
        if response.status_code == 200:
            data = response.json()
            
            if 'batches' in data:
                print(f"\n🎉 SUCCESS! Found {len(data['batches'])} batches:")
                
                for i, batch in enumerate(data['batches']):
                    print(f"\n  📦 Batch {i+1}:")
                    print(f"     Pages: {batch.get('pages', 'N/A')}")
                    
                    response_data = batch.get('response', {})
                    answer = response_data.get('answer', '')
                    references = response_data.get('references', [])
                    
                    print(f"     Answer length: {len(answer)} characters")
                    print(f"     References: {len(references)}")
                    
                    if answer:
                        print(f"     Answer preview: {answer[:100]}...")
                        
            else:
                print("❌ No 'batches' found in response")
                
        else:
            print(f"❌ Error: {response.text}")
            
    except requests.exceptions.ConnectionError:
        print("❌ Connection Error: Make sure the backend server is running on localhost:5001")
    except Exception as e:
        print(f"❌ Request failed: {e}")

def main():
    """Run manual tests"""
    print("🚀 MANUAL BATCHING FUNCTIONALITY TESTS")
    print("Make sure the backend server is running on localhost:5001")
    print("=" * 50)
    
    # Test simple batching
    test_simple_batching()
    
    # Test bracket grouping
    test_bracket_grouping()
    
    print("\n" + "=" * 50)
    print("✅ MANUAL TESTS COMPLETED")

if __name__ == "__main__":
    main() 