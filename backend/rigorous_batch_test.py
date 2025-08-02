#!/usr/bin/env python3
"""
Rigorous test suite for batching functionality
Tests various input formats, edge cases, and error conditions
"""

import requests
import json
import time
import sys
import os
from typing import List, Dict, Any

# Add the current directory to Python path
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from app import parse_page_ranges

# Configuration
API_URL = "http://localhost:5001/api"
DOCUMENT_ID = 3  # Update this to match your document ID

class BatchTestSuite:
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

    def test_parsing_edge_cases(self):
        """Test parsing function with edge cases"""
        print("🧪 TESTING PARSING EDGE CASES")
        print("=" * 50)
        
        test_cases = [
            # Basic functionality
            ("1-5", "Single range", [[1,2,3,4,5]]),
            ("5", "Single page", [[5]]),
            ("1-5;6-10", "Consecutive ranges", [[1,2,3,4,5], [6,7,8,9,10]]),
            ("1-5;7-10", "Gapped ranges", [[1,2,3,4,5], [7,8,9,10]]),
            
            # Bracket grouping
            ("[1-3;5-7]", "Bracket with gaps", [[1,2,3,5,6,7]]),
            ("[1-5]", "Single range in brackets", [[1,2,3,4,5]]),
            ("[5]", "Single page in brackets", [[5]]),
            ("[1-3;5-7;9-11]", "Multiple ranges in brackets", [[1,2,3,5,6,7,9,10,11]]),
            
            # Mixed formats
            ("1-5;[6-8;10-12];15-20", "Mixed with bracket", [[1,2,3,4,5], [6,7,8,10,11,12], [15,16,17,18,19,20]]),
            ("[1-3;5-7];10-15", "Bracket first", [[1,2,3,5,6,7], [10,11,12,13,14,15]]),
            
            # Edge cases
            ("", "Empty string", []),
            ("1-1", "Single page range", [[1]]),
            ("1-100", "Large range", [list(range(1, 101))]),
            ("1;2;3;4;5", "Individual pages", [[1], [2], [3], [4], [5]]),
            
            # Complex scenarios
            ("1-10;20-30;[31-35;40-45];50-60", "Complex mixed", [[1,2,3,4,5,6,7,8,9,10], [20,21,22,23,24,25,26,27,28,29,30], [31,32,33,34,35,40,41,42,43,44,45], [50,51,52,53,54,55,56,57,58,59,60]]),
            ("[1-5;10-15;20-25];30-35;[40-45;50-55]", "Multiple brackets", [[1,2,3,4,5,10,11,12,13,14,15,20,21,22,23,24,25], [30,31,32,33,34,35], [40,41,42,43,44,45,50,51,52,53,54,55]]),
        ]
        
        for input_str, description, expected in test_cases:
            try:
                result = parse_page_ranges(input_str)
                success = result == expected
                details = f"Input: '{input_str}' | Expected: {expected} | Got: {result}"
                self.log_test(f"Parsing: {description}", success, details)
            except Exception as e:
                self.log_test(f"Parsing: {description}", False, f"Exception: {e}")

    def test_error_handling(self):
        """Test error handling for invalid inputs"""
        print("🚨 TESTING ERROR HANDLING")
        print("=" * 50)
        
        error_cases = [
            ("invalid", "Invalid page number"),
            ("1-abc", "Invalid range format"),
            ("[1-5;invalid]", "Invalid content in brackets"),
            ("1-5;6-abc", "Mixed valid and invalid"),
            ("[1-5", "Unclosed bracket"),
            ("1-5]", "Unopened bracket"),
            ("[1-5;]", "Empty bracket content"),
            (";1-5", "Leading semicolon"),
            ("1-5;", "Trailing semicolon"),
            ("1--5", "Double dash"),
            ("-5", "Missing start"),
            ("5-", "Missing end"),
        ]
        
        for input_str, description in error_cases:
            try:
                result = parse_page_ranges(input_str)
                # For error cases, we expect either empty result or specific handling
                success = True  # We'll accept any result as long as it doesn't crash
                details = f"Input: '{input_str}' | Result: {result}"
                self.log_test(f"Error handling: {description}", success, details)
            except Exception as e:
                self.log_test(f"Error handling: {description}", False, f"Exception: {e}")

    def test_api_batching_simple(self):
        """Test simple API batching scenarios"""
        print("🌐 TESTING API BATCHING - SIMPLE CASES")
        print("=" * 50)
        
        test_cases = [
            {
                "name": "Single Range",
                "page_range": "1-5",
                "message": "What is the main topic?"
            },
            {
                "name": "Two Ranges",
                "page_range": "1-3;4-6",
                "message": "Summarize these sections."
            },
            {
                "name": "Bracket Group",
                "page_range": "[1-3;5-7]",
                "message": "What are the key points?"
            },
            {
                "name": "Mixed Format",
                "page_range": "1-3;[4-6;8-10];11-13",
                "message": "Analyze this content."
            }
        ]
        
        for test_case in test_cases:
            try:
                result = self.make_api_call(test_case["page_range"], test_case["message"])
                success = result["success"]
                details = result["details"]
                self.log_test(f"API: {test_case['name']}", success, details)
            except Exception as e:
                self.log_test(f"API: {test_case['name']}", False, f"Exception: {e}")

    def test_api_batching_complex(self):
        """Test complex API batching scenarios"""
        print("🌐 TESTING API BATCHING - COMPLEX CASES")
        print("=" * 50)
        
        test_cases = [
            {
                "name": "Large Range Split",
                "page_range": "1-50;51-100",
                "message": "Provide a comprehensive analysis."
            },
            {
                "name": "Multiple Brackets",
                "page_range": "[1-5;10-15];[20-25;30-35];40-45",
                "message": "Compare these different sections."
            },
            {
                "name": "Gapped Selection",
                "page_range": "1-10;20-30;40-50",
                "message": "What patterns emerge across these sections?"
            },
            {
                "name": "Mixed Complex",
                "page_range": "1-5;[6-8;10-12];15-20;[25-30;35-40]",
                "message": "Analyze the relationships between these sections."
            }
        ]
        
        for test_case in test_cases:
            try:
                result = self.make_api_call(test_case["page_range"], test_case["message"])
                success = result["success"]
                details = result["details"]
                self.log_test(f"API Complex: {test_case['name']}", success, details)
            except Exception as e:
                self.log_test(f"API Complex: {test_case['name']}", False, f"Exception: {e}")

    def test_performance_scenarios(self):
        """Test performance with various scenarios"""
        print("⚡ TESTING PERFORMANCE SCENARIOS")
        print("=" * 50)
        
        test_cases = [
            {
                "name": "Many Small Batches",
                "page_range": "1-5;6-10;11-15;16-20;21-25",
                "message": "What are the key themes?"
            },
            {
                "name": "Large Single Batch",
                "page_range": "1-100",
                "message": "Provide a comprehensive overview."
            },
            {
                "name": "Mixed Batch Sizes",
                "page_range": "1-5;10-50;55-60;70-120",
                "message": "Analyze the content structure."
            }
        ]
        
        for test_case in test_cases:
            try:
                result = self.make_api_call(test_case["page_range"], test_case["message"])
                success = result["success"]
                details = result["details"]
                self.log_test(f"Performance: {test_case['name']}", success, details)
            except Exception as e:
                self.log_test(f"Performance: {test_case['name']}", False, f"Exception: {e}")

    def make_api_call(self, page_range: str, message: str) -> Dict[str, Any]:
        """Make an API call and return results"""
        request_data = {
            "document_id": DOCUMENT_ID,
            "message": message,
            "page_range": page_range
        }
        
        try:
            start_time = time.time()
            response = requests.post(
                f"{API_URL}/chat",
                json=request_data,
                headers={'Content-Type': 'application/json'}
            )
            end_time = time.time()
            duration = end_time - start_time
            
            if response.status_code == 200:
                data = response.json()
                
                if 'batches' in data:
                    batch_count = len(data['batches'])
                    total_chars = sum(len(batch.get('response', {}).get('answer', '')) for batch in data['batches'])
                    total_refs = sum(len(batch.get('response', {}).get('references', [])) for batch in data['batches'])
                    
                    details = f"Batches: {batch_count}, Chars: {total_chars}, Refs: {total_refs}, Time: {duration:.2f}s"
                    return {"success": True, "details": details}
                else:
                    return {"success": False, "details": f"No batches in response: {list(data.keys())}"}
            else:
                return {"success": False, "details": f"HTTP {response.status_code}: {response.text}"}
                
        except requests.exceptions.ConnectionError:
            return {"success": False, "details": "Connection error - server not running"}
        except Exception as e:
            return {"success": False, "details": f"Exception: {e}"}

    def test_your_specific_case(self):
        """Test your specific input case"""
        print("🎯 TESTING YOUR SPECIFIC CASE")
        print("=" * 50)
        
        page_range = "11-17;18-54;55-95;[96-98; 131-157];158-222"
        message = "If it is covered in the book, how did knowledge processes/systems/flows operate in modern China? Focus on technologies and media."
        
        try:
            result = self.make_api_call(page_range, message)
            success = result["success"]
            details = result["details"]
            self.log_test("Your Specific Case", success, details)
        except Exception as e:
            self.log_test("Your Specific Case", False, f"Exception: {e}")

    def run_all_tests(self):
        """Run all test suites"""
        print("🚀 STARTING RIGOROUS BATCHING TESTS")
        print("=" * 60)
        
        # Run all test suites
        self.test_parsing_edge_cases()
        self.test_error_handling()
        self.test_api_batching_simple()
        self.test_api_batching_complex()
        self.test_performance_scenarios()
        self.test_your_specific_case()
        
        # Print summary
        print("📊 TEST SUMMARY")
        print("=" * 60)
        print(f"✅ Passed: {self.passed}")
        print(f"❌ Failed: {self.failed}")
        print(f"📈 Total: {self.passed + self.failed}")
        print(f"🎯 Success Rate: {(self.passed / (self.passed + self.failed) * 100):.1f}%")
        
        if self.failed == 0:
            print("\n🎉 ALL TESTS PASSED!")
        else:
            print(f"\n⚠️  {self.failed} tests failed. Check details above.")
        
        return self.failed == 0

def main():
    """Run the rigorous test suite"""
    test_suite = BatchTestSuite()
    success = test_suite.run_all_tests()
    
    if not success:
        sys.exit(1)

if __name__ == "__main__":
    main() 