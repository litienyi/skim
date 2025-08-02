#!/usr/bin/env python3
"""
Test script for the specific user input
"""

import requests
import json
import time

# Configuration
API_URL = "http://localhost:5001/api"
DOCUMENT_ID = 3  # Update this to match your document ID

def test_specific_input():
    """Test the specific user input"""
    print("🎯 TESTING YOUR SPECIFIC INPUT")
    print("=" * 50)
    
    # Your specific input
    page_range = "11-17;18-54;55-95;[96-98; 131-157];158-222"
    message = "If it is covered in the book, how did knowledge processes/systems/flows (e.g., production, circulation, transmission, reception, storage, organization, control, censorship, standardization, operationalization, authentication, valorization, commercialization, and safeguarding) operate in modern China? Focus on technologies and media."
    
    print(f"Page Range: {page_range}")
    print(f"Message: {message[:100]}...")
    
    # Prepare request
    request_data = {
        "document_id": DOCUMENT_ID,
        "message": message,
        "page_range": page_range
    }
    
    print(f"\n📤 Sending request to: {API_URL}/chat")
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
                        print(f"     Answer preview: {answer[:200]}...")
                    
                    if references:
                        print(f"     First reference: {references[0] if references else 'None'}")
                        
                # Summary
                total_answer_length = sum(len(batch.get('response', {}).get('answer', '')) for batch in data['batches'])
                total_references = sum(len(batch.get('response', {}).get('references', [])) for batch in data['batches'])
                print(f"\n📊 SUMMARY:")
                print(f"     Total batches: {len(data['batches'])}")
                print(f"     Total answer length: {total_answer_length} characters")
                print(f"     Total references: {total_references}")
                        
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

if __name__ == "__main__":
    test_specific_input() 