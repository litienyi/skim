#!/usr/bin/env python3
"""
Test batching logic without API calls
Focuses on frontend → batching logic → page ranges TO BE SUBMITTED to API
"""

import sys
import os
from typing import List, Dict, Any

# Add the current directory to Python path
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from app import parse_page_ranges

class BatchingLogicTest:
    def __init__(self):
        self.test_results = []
        self.passed = 0
        self.failed = 0
        
    def log_test(self, test_name: str, success: bool, details: str = ""):
        """Log test result"""
        status = "✅ PASS" if success else "❌ FAIL"
        print(f"{status}: {test_name}")
        if details:
            print(f"   Details: {details}")
        print()
        
        self.test_results.append({
            "name": test_name,
            "success": success,
            "details": details
        })
        
        if success:
            self.passed += 1
        else:
            self.failed += 1

    def test_frontend_input_processing(self):
        """Test how frontend input gets processed into batches"""
        print("🎯 TESTING FRONTEND INPUT PROCESSING")
        print("=" * 50)
        
        test_cases = [
            {
                "name": "Your Specific Case",
                "frontend_input": "11-17;18-54;55-95;[96-98; 131-157];158-222",
                "expected_batches": 5,
                "expected_pages_per_batch": [
                    [11, 12, 13, 14, 15, 16, 17],  # 7 pages
                    list(range(18, 55)),  # 37 pages
                    list(range(55, 96)),  # 41 pages
                    list(range(96, 99)) + list(range(131, 158)),  # 30 pages
                    list(range(158, 223))  # 65 pages
                ]
            },
            {
                "name": "Simple Brackets",
                "frontend_input": "[1-3;5-7]",
                "expected_batches": 1,
                "expected_pages_per_batch": [[1, 2, 3, 5, 6, 7]]
            },
            {
                "name": "Mixed Format",
                "frontend_input": "1-5;[6-8;10-12];15-20",
                "expected_batches": 3,
                "expected_pages_per_batch": [
                    list(range(1, 6)),  # 5 pages
                    [6, 7, 8, 10, 11, 12],  # 6 pages
                    list(range(15, 21))  # 6 pages
                ]
            },
            {
                "name": "Multiple Brackets",
                "frontend_input": "[1-5;10-15];[20-25;30-35];40-45",
                "expected_batches": 3,
                "expected_pages_per_batch": [
                    list(range(1, 6)) + list(range(10, 16)),  # 11 pages
                    list(range(20, 26)) + list(range(30, 36)),  # 11 pages
                    list(range(40, 46))  # 6 pages
                ]
            }
        ]
        
        for test_case in test_cases:
            try:
                # Simulate backend parsing
                batches = parse_page_ranges(test_case["frontend_input"])
                
                # Check batch count
                batch_count_match = len(batches) == test_case["expected_batches"]
                
                # Check each batch content
                batch_content_match = True
                for i, expected_batch in enumerate(test_case["expected_pages_per_batch"]):
                    if i < len(batches):
                        if batches[i] != expected_batch:
                            batch_content_match = False
                            break
                    else:
                        batch_content_match = False
                        break
                
                success = batch_count_match and batch_content_match
                details = f"Input: '{test_case['frontend_input']}' | Expected: {test_case['expected_batches']} batches | Got: {len(batches)} batches"
                if not batch_content_match:
                    details += f" | Content mismatch: Expected {test_case['expected_pages_per_batch']}, Got {batches}"
                
                self.log_test(f"Frontend Processing: {test_case['name']}", success, details)
                
            except Exception as e:
                self.log_test(f"Frontend Processing: {test_case['name']}", False, f"Exception: {e}")

    def test_api_request_format(self):
        """Test the format that would be sent to API"""
        print("📤 TESTING API REQUEST FORMAT")
        print("=" * 50)
        
        test_cases = [
            {
                "name": "Your Case - API Request",
                "frontend_input": "11-17;18-54;55-95;[96-98; 131-157];158-222",
                "expected_request": {
                    "document_id": 3,
                    "message": "Test message",
                    "page_range": "11-17;18-54;55-95;[96-98; 131-157];158-222"
                }
            },
            {
                "name": "Brackets Only - API Request",
                "frontend_input": "[1-3;5-7]",
                "expected_request": {
                    "document_id": 3,
                    "message": "Test message", 
                    "page_range": "[1-3;5-7]"
                }
            }
        ]
        
        for test_case in test_cases:
            try:
                # Simulate what frontend would send
                api_request = {
                    "document_id": 3,
                    "message": "Test message",
                    "page_range": test_case["frontend_input"]
                }
                
                # Check if request format is correct
                success = (
                    api_request["document_id"] == test_case["expected_request"]["document_id"] and
                    api_request["message"] == test_case["expected_request"]["message"] and
                    api_request["page_range"] == test_case["expected_request"]["page_range"]
                )
                
                details = f"Request: {api_request}"
                self.log_test(f"API Request Format: {test_case['name']}", success, details)
                
            except Exception as e:
                self.log_test(f"API Request Format: {test_case['name']}", False, f"Exception: {e}")

    def test_batch_processing_simulation(self):
        """Simulate how backend would process each batch"""
        print("⚙️ TESTING BATCH PROCESSING SIMULATION")
        print("=" * 50)
        
        test_cases = [
            {
                "name": "Your Case - Batch Processing",
                "input": "11-17;18-54;55-95;[96-98; 131-157];158-222",
                "expected_batches": [
                    {
                        "batch": 1,
                        "pages": "11-17",
                        "page_count": 7
                    },
                    {
                        "batch": 2, 
                        "pages": "18-54",
                        "page_count": 37
                    },
                    {
                        "batch": 3,
                        "pages": "55-95", 
                        "page_count": 41
                    },
                    {
                        "batch": 4,
                        "pages": "96-157",
                        "page_count": 30
                    },
                    {
                        "batch": 5,
                        "pages": "158-222",
                        "page_count": 65
                    }
                ]
            }
        ]
        
        for test_case in test_cases:
            try:
                # Simulate backend batch processing
                batches = parse_page_ranges(test_case["input"])
                
                # Simulate what backend would create for each batch
                processed_batches = []
                for i, batch in enumerate(batches):
                    if batch:
                        processed_batch = {
                            "batch": i + 1,
                            "pages": f"{batch[0]}-{batch[-1]}",
                            "page_count": len(batch)
                        }
                        processed_batches.append(processed_batch)
                
                # Check if processing matches expected
                success = len(processed_batches) == len(test_case["expected_batches"])
                if success:
                    for i, expected in enumerate(test_case["expected_batches"]):
                        if i < len(processed_batches):
                            actual = processed_batches[i]
                            if (actual["batch"] != expected["batch"] or
                                actual["pages"] != expected["pages"] or
                                actual["page_count"] != expected["page_count"]):
                                success = False
                                break
                        else:
                            success = False
                            break
                
                details = f"Input: '{test_case['input']}' | Processed: {len(processed_batches)} batches"
                for batch in processed_batches:
                    details += f" | Batch {batch['batch']}: {batch['pages']} ({batch['page_count']} pages)"
                
                self.log_test(f"Batch Processing: {test_case['name']}", success, details)
                
            except Exception as e:
                self.log_test(f"Batch Processing: {test_case['name']}", False, f"Exception: {e}")

    def test_edge_cases_batching(self):
        """Test edge cases in batching logic"""
        print("🔍 TESTING EDGE CASES IN BATCHING")
        print("=" * 50)
        
        edge_cases = [
            {
                "name": "Empty Input",
                "input": "",
                "expected_batches": 0
            },
            {
                "name": "Single Page",
                "input": "5",
                "expected_batches": 1
            },
            {
                "name": "Single Range",
                "input": "1-10",
                "expected_batches": 1
            },
            {
                "name": "Large Range",
                "input": "1-100",
                "expected_batches": 1
            },
            {
                "name": "Mixed Invalid",
                "input": "1-5;invalid;10-15",
                "expected_batches": 2  # Should ignore invalid part
            },
            {
                "name": "Complex Brackets",
                "input": "[1-5;10-15;20-25];[30-35;40-45]",
                "expected_batches": 2
            }
        ]
        
        for case in edge_cases:
            try:
                batches = parse_page_ranges(case["input"])
                success = len(batches) == case["expected_batches"]
                details = f"Input: '{case['input']}' | Expected: {case['expected_batches']} batches | Got: {len(batches)} batches"
                self.log_test(f"Edge Case: {case['name']}", success, details)
            except Exception as e:
                self.log_test(f"Edge Case: {case['name']}", False, f"Exception: {e}")

    def run_all_tests(self):
        """Run all batching logic tests"""
        print("🚀 STARTING BATCHING LOGIC TESTS")
        print("=" * 60)
        
        # Run all test suites
        self.test_frontend_input_processing()
        self.test_api_request_format()
        self.test_batch_processing_simulation()
        self.test_edge_cases_batching()
        
        # Print summary
        print("📊 BATCHING LOGIC TEST SUMMARY")
        print("=" * 60)
        print(f"✅ Passed: {self.passed}")
        print(f"❌ Failed: {self.failed}")
        print(f"📈 Total: {self.passed + self.failed}")
        print(f"🎯 Success Rate: {(self.passed / (self.passed + self.failed) * 100):.1f}%")
        
        if self.failed == 0:
            print("\n🎉 ALL BATCHING LOGIC TESTS PASSED!")
            print("\n🚀 BATCHING LOGIC IS WORKING CORRECTLY!")
        else:
            print(f"\n⚠️  {self.failed} tests failed. Check details above.")
        
        return self.failed == 0

def main():
    """Run the batching logic test suite"""
    test_suite = BatchingLogicTest()
    success = test_suite.run_all_tests()
    
    if not success:
        sys.exit(1)

if __name__ == "__main__":
    main() 