#!/usr/bin/env python3
"""
Console interface for Gemini structured output using response_schema (recommended way).
"""
import os
import google.generativeai as genai
from dotenv import load_dotenv
from pydantic import BaseModel, Field
from typing import List, Optional
import textwrap
import json

# Load environment variables from backend directory
load_dotenv('backend/.env')

# Configure Gemini
api_key = os.getenv('GOOGLE_API_KEY')
if not api_key:
    print("❌ Error: GOOGLE_API_KEY not found in environment variables.")
    print("Please create a .env file in the backend directory with your Google API key:")
    print("GOOGLE_API_KEY=your_api_key_here")
    exit(1)

genai.configure(api_key=api_key)
model = genai.GenerativeModel('models/gemini-2.0-flash')

# Define the structured output schema using Pydantic - DESCRIPTIVE
class Reference(BaseModel):
    quote: str
    source: str  
    context: str
    relevance: int

class TextAnalysis(BaseModel):
    text_id: int  # Which text this analysis is for
    answer: str
    references: List[Reference]
    summary: str

class AnalysisResponse(BaseModel):
    analyses: List[TextAnalysis]  # One analysis per input text

def get_user_input(prompt, multiline=False):
    print(f"\n{prompt}")
    if multiline:
        print("(Enter your text. Type 'END' on a new line when done)")
        lines = []
        while True:
            line = input()
            if line.strip().upper() == 'END':
                break
            lines.append(line)
        return '\n'.join(lines)
    else:
        return input().strip()

def get_multiple_texts():
    print("\n📚 TEXT INPUT OPTIONS")
    print("=" * 40)
    print("1. Load from text file (one entry per line)")
    print("2. Manual input")
    
    choice = input("\nChoose option (1 or 2): ").strip()
    
    if choice == "1":
        return load_texts_from_file()
    else:
        return load_texts_manually()

def load_texts_from_file():
    texts = []
    while True:
        file_path = input("\n📁 Enter path to text file (or 'back' to return): ").strip()
        if file_path.lower() == 'back':
            return get_multiple_texts()
        
        try:
            with open(file_path, 'r', encoding='utf-8') as file:
                lines = file.readlines()
            
            # Filter out empty lines and strip whitespace
            entries = [line.strip() for line in lines if line.strip()]
            
            if not entries:
                print("❌ File is empty or contains no valid entries.")
                continue
            
            print(f"\n✅ Loaded {len(entries)} entries from file")
            print(f"📄 File: {file_path}")
            
            # Create text objects
            for i, entry in enumerate(entries, 1):
                texts.append({
                    'id': i,
                    'content': entry
                })
            
            print(f"📊 Total characters: {sum(len(t['content']) for t in texts)}")
            return texts
            
        except FileNotFoundError:
            print(f"❌ File not found: {file_path}")
        except Exception as e:
            print(f"❌ Error reading file: {e}")

def load_texts_manually():
    texts = []
    text_count = 0
    print("\n📝 MANUAL TEXT INPUT")
    print("=" * 40)
    print("You can input multiple texts for analysis.")
    print("Each text will be numbered and analyzed together.")
    while True:
        text_count += 1
        print(f"\n📄 TEXT #{text_count}")
        print("-" * 20)
        text = get_user_input(f"Enter text #{text_count} (or 'done' to finish):", multiline=True)
        if text.lower() in ['done', 'finish', 'quit', 'exit']:
            if text_count == 1:
                print("❌ Please enter at least one text to analyze.")
                continue
            break
        if not text.strip():
            print("❌ Please enter some text or type 'done' to finish.")
            text_count -= 1
            continue
        texts.append({
            'id': text_count,
            'content': text.strip()
        })
        print(f"✅ Text #{text_count} added ({len(text.strip())} characters)")
        if text_count >= 1:
            more = input(f"\nAdd another text? (y/n): ").lower().strip()
            if more not in ['y', 'yes', '']:
                break
    return texts

def create_structured_prompt(texts, user_question):
    texts_section = ""
    for text in texts:
        texts_section += f"""
TEXT #{text['id']}:
{text['content']}
"""
    prompt = f"""
You are an AI assistant that analyzes multiple academic texts and provides answers with direct references.

{texts_section}
USER QUESTION:
{user_question}

For each text, provide:
1. A clear answer to the question
2. Direct quotes from the text with source attribution
3. Context for each quote
4. Relevance scores (1-100) for each quote
5. A brief summary of your analysis

Be thorough and include specific details from each text.
"""
    return prompt

def analyze_with_structured_output(texts, user_question):
    # Check if we need to batch process due to size
    total_chars = sum(len(text['content']) for text in texts)
    print(f"\n🔍 DEBUG: Total characters: {total_chars}")
    
    # If too large, process in batches
    if total_chars > 30000:  # Conservative limit
        print(f"⚠️  Large dataset detected ({total_chars} chars). Processing in batches...")
        return analyze_in_batches(texts, user_question)
    
    prompt = create_structured_prompt(texts, user_question)
    print(f"\n🔍 DEBUG: Using Gemini structured output with response_schema")
    print(f"📝 Prompt length: {len(prompt)} characters")
    print(f"📚 Number of texts: {len(texts)}")
    
    # Debug schema
    print(f"\n🔧 DEBUG: Schema details:")
    print(f"📋 AnalysisResponse schema: {AnalysisResponse.model_json_schema()}")
    print(f"📋 Reference schema: {Reference.model_json_schema()}")
    
    response = None  # Initialize response variable
    try:
        print(f"\n🚀 DEBUG: Calling Gemini with response_schema...")
        response = model.generate_content(
            prompt,
            generation_config={
                "response_mime_type": "application/json",
                "response_schema": AnalysisResponse
            }
        )
        print(f"✅ DEBUG: Gemini response received successfully")
        print(f"📄 Response type: {type(response)}")
        print(f"📄 Response text length: {len(response.text)} characters")
        print(f"📄 Response text preview: {response.text[:200]}...")
        
        # Try to parse JSON
        print(f"\n🔍 DEBUG: Attempting to parse JSON...")
        parsed_json = json.loads(response.text)
        print(f"✅ DEBUG: JSON parsed successfully")
        print(f"📋 Parsed JSON keys: {list(parsed_json.keys())}")
        
        # Try to validate with Pydantic
        print(f"\n🔍 DEBUG: Attempting Pydantic validation...")
        validated_response = AnalysisResponse.model_validate(parsed_json)
        print(f"✅ DEBUG: Pydantic validation successful")
        return validated_response
        
    except json.JSONDecodeError as e:
        print(f"\n❌ JSON Decode Error: {e}")
        print("Raw response text:")
        print(response.text)
        raise
    except Exception as e:
        print(f"\n❌ Error in structured output: {e}")
        print(f"❌ Error type: {type(e)}")
        print("Raw response text:")
        print(response.text)
        
        # Fallback: Try without response_schema
        print(f"\n🔄 DEBUG: Attempting fallback without response_schema...")
        try:
            fallback_response = model.generate_content(prompt)
            print(f"✅ DEBUG: Fallback response received")
            print(f"📄 Fallback response length: {len(fallback_response.text)} characters")
            print(f"📄 Fallback response preview: {fallback_response.text[:200]}...")
            
            # Try to extract JSON from the response
            import re
            json_match = re.search(r'\{.*\}', fallback_response.text, re.DOTALL)
            if json_match:
                json_str = json_match.group()
                print(f"🔍 DEBUG: Found JSON in fallback response")
                parsed_json = json.loads(json_str)
                validated_response = AnalysisResponse.model_validate(parsed_json)
                print(f"✅ DEBUG: Fallback validation successful")
                return validated_response
            else:
                print(f"❌ DEBUG: No JSON found in fallback response")
                raise Exception("No JSON found in fallback response")
        except Exception as fallback_error:
            print(f"❌ DEBUG: Fallback also failed: {fallback_error}")
            raise e  # Re-raise the original error

def analyze_in_batches(texts, user_question, batch_size=10):
    """Process large datasets in batches to avoid token limits."""
    print(f"\n🔄 BATCH PROCESSING: {len(texts)} texts in batches of {batch_size}")
    
    all_responses = []
    
    for i in range(0, len(texts), batch_size):
        batch = texts[i:i + batch_size]
        batch_num = (i // batch_size) + 1
        total_batches = (len(texts) + batch_size - 1) // batch_size
        
        print(f"\n📦 Processing batch {batch_num}/{total_batches} ({len(batch)} texts)")
        
        try:
            batch_response = analyze_with_structured_output(batch, user_question)
            all_responses.append(batch_response)
            print(f"✅ Batch {batch_num} completed successfully")
        except Exception as e:
            print(f"❌ Batch {batch_num} failed: {e}")
            # Continue with next batch
    
    # Combine all batch responses
    if all_responses:
        return combine_batch_responses(all_responses)
    else:
        raise Exception("All batches failed")

def combine_batch_responses(batch_responses):
    """Combine multiple batch responses into a single response."""
    all_analyses = []
    
    for batch_response in batch_responses:
        # Each batch response should contain analyses for multiple texts
        if hasattr(batch_response, 'analyses'):
            all_analyses.extend(batch_response.analyses)
        else:
            # Fallback: if old format, convert to new format
            all_analyses.append(TextAnalysis(
                text_id=1,  # Default fallback
                answer=batch_response.a if hasattr(batch_response, 'a') else "No answer provided",
                references=batch_response.refs if hasattr(batch_response, 'refs') else [],
                summary=batch_response.sum if hasattr(batch_response, 'sum') else "No summary provided"
            ))
    
    return AnalysisResponse(analyses=all_analyses)

def format_structured_response(response_data, texts):
    print("\n" + "="*60)
    print("🤖 GEMINI STRUCTURED OUTPUT RESPONSE")
    print("="*60)
    try:
        print(f"\n📊 TOTAL ANALYSES: {len(response_data.analyses)}")
        print("="*60)
        
        for analysis in response_data.analyses:
            print(f"\n📄 TEXT #{analysis.text_id} ANALYSIS:")
            print("-" * 40)
            print(f"📝 ANSWER:")
            print(textwrap.fill(analysis.answer, width=80))
            
            if analysis.references:
                print(f"\n📚 REFERENCES ({len(analysis.references)}):")
                for i, ref in enumerate(analysis.references, 1):
                    print(f"\n{i}. Quote: \"{ref.quote}\"")
                    print(f"   Source: {ref.source}")
                    print(f"   Context: {ref.context}")
                    print(f"   Relevance: {ref.relevance}/100")
            
            print(f"\n📋 SUMMARY:")
            print(textwrap.fill(analysis.summary, width=80))
            print("-" * 40)
        
        print(f"\n📄 ANALYZED TEXTS SUMMARY:")
        print("-" * 30)
        for text in texts:
            print(f"Text #{text['id']}: {len(text['content'])} characters")
        print("\n🔧 STRUCTURED OUTPUT:")
        print("-" * 30)
        print("✅ Gemini response_schema used for robust JSON output")
        print("✅ One analysis per input text (1:1 mapping)")
    except Exception as e:
        print(f"\n❌ Error displaying response: {e}")
    print("\n" + "="*60)

def main():
    print("🔍 GEMINI STRUCTURED OUTPUT CONSOLE")
    print("=" * 50)
    print("This interface uses Gemini's response_schema for robust structured output.")
    print("No sentence-level indexing required!")
    print("Direct quotes with relevance scores!")
    while True:
        try:
            print("\n" + "="*50)
            texts = get_multiple_texts()
            if not texts:
                print("❌ No texts provided. Exiting.")
                break
            print(f"\n✅ Successfully loaded {len(texts)} text(s) for analysis")
            user_question = get_user_input("❓ Enter your question about the texts:")
            if not user_question.strip():
                print("❌ Please enter a question.")
                continue
            print("\n🔄 Processing with Gemini AI (Structured Output)...")
            response_data = analyze_with_structured_output(texts, user_question)
            format_structured_response(response_data, texts)
            continue_choice = input("\n🔄 Analyze another set of texts? (y/n): ").lower().strip()
            if continue_choice not in ['y', 'yes', '']:
                print("👋 Goodbye!")
                break
        except KeyboardInterrupt:
            print("\n\n👋 Goodbye!")
            break
        except Exception as e:
            print(f"\n❌ Error: {str(e)}")
            print("Please try again.")

if __name__ == "__main__":
    main() 