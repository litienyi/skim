#!/usr/bin/env python3
"""
Simple test script to demonstrate the structured output approach.
This shows how the new approach eliminates sentence-level indexing.
"""

import json
import textwrap

# Sample text for testing
SAMPLE_TEXT = """
Climate change is one of the most pressing issues facing humanity today. The Intergovernmental Panel on Climate Change (IPCC) has reported that global temperatures have increased by 1.1°C since pre-industrial times, leading to widespread ecological changes. 

Research published in Nature shows that agricultural yields decreased by 15% in regions experiencing temperature increases above 2°C. This has significant implications for global food security, particularly in developing nations that rely heavily on agriculture.

The study also found that extreme weather events have become more frequent and intense. Hurricanes, droughts, and heatwaves are occurring with greater regularity, causing billions of dollars in damage annually. Coastal communities are particularly vulnerable to rising sea levels, which are projected to increase by 0.3 to 1.1 meters by 2100.

Scientists agree that immediate action is required to mitigate the most severe impacts of climate change. This includes reducing greenhouse gas emissions, transitioning to renewable energy sources, and implementing adaptation strategies for vulnerable communities.
"""

# OpenAPI Schema for structured output
STRUCTURED_OUTPUT_SCHEMA = {
    "type": "object",
    "properties": {
        "answer": {
            "type": "string",
            "description": "A comprehensive answer to the user's question based on the provided text"
        },
        "references": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "quote": {
                        "type": "string",
                        "description": "Exact quote from the source text, enclosed in quotation marks"
                    },
                    "context": {
                        "type": "string",
                        "description": "Brief context about where this quote appears or what it refers to"
                    },
                    "relevance_score": {
                        "type": "integer",
                        "minimum": 1,
                        "maximum": 100,
                        "description": "Relevance score from 1-100 indicating how relevant this quote is to the answer"
                    }
                },
                "required": ["quote", "context", "relevance_score"]
            },
            "description": "List of direct quotes from the source text that support the answer"
        },
        "summary": {
            "type": "string",
            "description": "Brief summary of the key findings or main points from the analysis"
        }
    },
    "required": ["answer", "references", "summary"]
}

def simulate_gemini_response(question):
    """Simulate what Gemini would return with structured output."""
    
    if "impact" in question.lower():
        return {
            "answer": "Climate change has significant and measurable impacts on global ecosystems, agriculture, and human communities. The research shows direct effects on temperature, food production, and extreme weather events.",
            "references": [
                {
                    "quote": "global temperatures have increased by 1.1°C since pre-industrial times, leading to widespread ecological changes",
                    "context": "IPCC temperature findings",
                    "relevance_score": 95
                },
                {
                    "quote": "agricultural yields decreased by 15% in regions experiencing temperature increases above 2°C",
                    "context": "Nature research on agricultural impacts",
                    "relevance_score": 92
                },
                {
                    "quote": "extreme weather events have become more frequent and intense",
                    "context": "Weather pattern changes",
                    "relevance_score": 88
                },
                {
                    "quote": "immediate action is required to mitigate the most severe impacts of climate change",
                    "context": "Scientific consensus on action needed",
                    "relevance_score": 85
                }
            ],
            "summary": "Climate change is causing measurable impacts on global temperatures, agriculture, and weather patterns, requiring immediate mitigation efforts."
        }
    elif "solution" in question.lower() or "action" in question.lower():
        return {
            "answer": "The text outlines several key actions needed to address climate change, including emission reductions, renewable energy transition, and adaptation strategies.",
            "references": [
                {
                    "quote": "immediate action is required to mitigate the most severe impacts of climate change",
                    "context": "Urgency of response",
                    "relevance_score": 95
                },
                {
                    "quote": "reducing greenhouse gas emissions, transitioning to renewable energy sources, and implementing adaptation strategies",
                    "context": "Specific action items",
                    "relevance_score": 90
                },
                {
                    "quote": "coastal communities are particularly vulnerable to rising sea levels",
                    "context": "Vulnerability assessment",
                    "relevance_score": 85
                }
            ],
            "summary": "Comprehensive climate action requires emission reductions, renewable energy adoption, and targeted adaptation strategies for vulnerable communities."
        }
    else:
        return {
            "answer": "The text provides a comprehensive overview of climate change, covering its current impacts, scientific findings, and the need for immediate action.",
            "references": [
                {
                    "quote": "Climate change is one of the most pressing issues facing humanity today",
                    "context": "Main thesis statement",
                    "relevance_score": 90
                },
                {
                    "quote": "The Intergovernmental Panel on Climate Change (IPCC) has reported",
                    "context": "Scientific authority reference",
                    "relevance_score": 85
                },
                {
                    "quote": "Scientists agree that immediate action is required",
                    "context": "Scientific consensus",
                    "relevance_score": 88
                }
            ],
            "summary": "Climate change represents a critical global challenge with established scientific consensus requiring urgent action across multiple fronts."
        }

def display_results(question, response):
    """Display the structured response in a readable format."""
    print("\n" + "="*80)
    print("🔍 STRUCTURED ANALYSIS RESULTS")
    print("="*80)
    
    print(f"\n📄 SAMPLE TEXT:")
    print("-" * 40)
    print(textwrap.fill(SAMPLE_TEXT, width=80))
    
    print(f"\n❓ QUESTION: {question}")
    
    print(f"\n📝 ANSWER:")
    print("-" * 40)
    print(textwrap.fill(response['answer'], width=80))
    
    print(f"\n📚 REFERENCES:")
    print("-" * 40)
    for i, ref in enumerate(response['references'], 1):
        print(f"\n{i}. Quote: \"{ref['quote']}\"")
        print(f"   Context: {ref['context']}")
        print(f"   Relevance: {ref['relevance_score']}/100")
    
    print(f"\n📋 SUMMARY:")
    print("-" * 40)
    print(textwrap.fill(response['summary'], width=80))
    
    print("\n" + "="*80)

def main():
    """Main test function."""
    print("🧪 TESTING STRUCTURED OUTPUT APPROACH")
    print("=" * 50)
    print("This demonstrates how structured output eliminates sentence-level indexing.")
    print("Instead of complex sentence tracking, Gemini quotes directly from the text.")
    
    # Test questions
    test_questions = [
        "What are the impacts of climate change?",
        "What solutions are proposed?",
        "What is the main message about climate change?"
    ]
    
    for question in test_questions:
        print(f"\n\n{'='*60}")
        print(f"TESTING QUESTION: {question}")
        print('='*60)
        
        # Simulate Gemini response
        response = simulate_gemini_response(question)
        
        # Display results
        display_results(question, response)
    
    print("\n\n🎯 KEY BENEFITS OF THIS APPROACH:")
    print("=" * 50)
    print("✅ No sentence-level indexing required")
    print("✅ No complex database schema for sentences")
    print("✅ No word position tracking")
    print("✅ No sentence boundary detection")
    print("✅ Direct quotes with relevance scores")
    print("✅ Structured, reliable output format")
    print("✅ Simpler codebase and maintenance")
    print("✅ Better user experience with actual quotes")

if __name__ == "__main__":
    main() 