#!/usr/bin/env python3
"""
Simple test script for parse_page_ranges function
Can be run without the API server
"""

import sys
import os

# Add the current directory to Python path
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from app import parse_page_ranges

def test_parsing():
    """Test the parse_page_ranges function"""
    print("🧪 TESTING PAGE RANGE PARSING")
    print("=" * 40)
    
    test_cases = [
        # Basic functionality
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
        
        # Your specific example
        ("11-17;18-54;55-95;[96-98; 131-157];158-222", "Your specific example"),
    ]
    
    all_passed = True
    
    for input_str, description in test_cases:
        print(f"\n--- {description} ---")
        print(f"Input: '{input_str}'")
        
        try:
            result = parse_page_ranges(input_str)
            print(f"✅ Result: {result}")
            print(f"   Number of batches: {len(result)}")
            
            for i, batch in enumerate(result):
                if batch:
                    print(f"   Batch {i+1}: {len(batch)} pages ({batch[0]}-{batch[-1]})")
                else:
                    print(f"   Batch {i+1}: Empty")
                    
        except Exception as e:
            print(f"❌ Error: {e}")
            all_passed = False
    
    print("\n" + "=" * 40)
    if all_passed:
        print("✅ ALL PARSING TESTS PASSED")
    else:
        print("❌ SOME TESTS FAILED")
    
    return all_passed

def test_specific_example():
    """Test your specific example in detail"""
    print("\n🎯 TESTING YOUR SPECIFIC EXAMPLE")
    print("=" * 40)
    
    example = "11-17;18-54;55-95;[96-98; 131-157];158-222"
    print(f"Input: '{example}'")
    
    try:
        batches = parse_page_ranges(example)
        print(f"✅ Parsed into {len(batches)} batches:")
        
        for i, batch in enumerate(batches):
            print(f"   Batch {i+1}: {len(batch)} pages")
            print(f"      Pages: {batch}")
            print(f"      Range: {batch[0]}-{batch[-1]}")
            
        # Verify the expected structure
        expected_batches = 5
        if len(batches) == expected_batches:
            print(f"✅ Correct number of batches ({expected_batches})")
        else:
            print(f"❌ Expected {expected_batches} batches, got {len(batches)}")
            
    except Exception as e:
        print(f"❌ Error: {e}")

if __name__ == "__main__":
    # Test basic parsing
    success = test_parsing()
    
    # Test specific example
    test_specific_example()
    
    if success:
        print("\n🎉 All tests completed successfully!")
    else:
        print("\n💥 Some tests failed!")
        sys.exit(1) 