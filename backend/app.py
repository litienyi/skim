from flask import Flask, request, jsonify, send_file
import os
import logging
from werkzeug.utils import secure_filename
import fitz  # PyMuPDF
import io
import json
import google.generativeai as genai
from dotenv import load_dotenv
from pydantic import BaseModel
from typing import List
import numpy as np
import pandas as pd
from sentence_transformers import SentenceTransformer
from sklearn.cluster import KMeans, DBSCAN
from sklearn.metrics.pairwise import cosine_similarity
from sklearn.decomposition import PCA
import pickle
from database import (
    init_db, get_document_id, save_page, save_block, save_sentence,
    get_document_blocks, get_document_sentences, save_words, get_block_words,
    get_db_connection, save_document, reinitialize_db, reset_sentence_numbers,
    sync_sentences, create_session, get_sessions, get_session, delete_session,
    save_session_data, load_session_data
)
import time
from google.api_core import retry
from google.api_core.exceptions import ResourceExhausted
from datetime import datetime

# Load environment variables
load_dotenv()

# Configure logging first
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger(__name__)

# Configure Gemini
api_key = os.getenv('GOOGLE_API_KEY')
if not api_key:
    logger.error("GOOGLE_API_KEY not found in environment variables. Please set it in a .env file.")
    logger.error("Chat functionality will not work without a valid API key.")
else:
    logger.info("Gemini API key found and configured.")
    
genai.configure(api_key=api_key)
model = genai.GenerativeModel('models/gemini-2.0-flash')

# Pydantic schema for structured chat responses
class RelevantSentence(BaseModel):
    sentence_number: int
    text: str
    relevance_score: float  # 0-100

class ChatResponse(BaseModel):
    relevant_sentences: List[RelevantSentence]
    overall_relevance_score: float  # 0-100
    explanation: str
    answer: str

# Pydantic schema for grid analysis
class TextInput(BaseModel):
    id: int
    content: str

class Reference(BaseModel):
    quote: str
    source: str
    context: str
    relevance: int

class AnalysisResponse(BaseModel):
    text_id: int
    answer: str
    references: List[Reference]
    summary: str

class GridAnalysisRequest(BaseModel):
    texts: List[TextInput]
    question: str

class GridAnalysisResponse(BaseModel):
    analyses: List[AnalysisResponse]

# Clustering schemas
class ClusteringRequest(BaseModel):
    texts: List[TextInput]
    method: str = "kmeans"  # "kmeans" or "dbscan"
    n_clusters: int = 5
    eps: float = 0.3  # for DBSCAN
    min_samples: int = 2  # for DBSCAN

class ClusterItem(BaseModel):
    text_id: int
    text: str
    cluster_id: int
    similarity_score: float

class DimensionInfo(BaseModel):
    dimension_id: int
    type: str  # "original", "pca", "cluster"
    name: str
    description: str
    variance_explained: float = None  # for PCA dimensions
    top_features: List[str] = []  # for PCA dimensions

class ClusterGroup(BaseModel):
    cluster_id: int
    items: List[ClusterItem]
    centroid_text: str
    size: int
    semantic_definition: str
    key_themes: List[str]
    representative_examples: List[str]

class ClusteringResponse(BaseModel):
    clusters: List[ClusterGroup]
    dimensions: List[DimensionInfo]
    method: str
    parameters: dict
    total_items: int
    pca_explained_variance: float = None

app = Flask(__name__)

# Configure upload folder
UPLOAD_FOLDER = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'uploads')
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER

# Create uploads directory if it doesn't exist
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

# Initialize database
init_db()

# Initialize sentence transformer model
try:
    sentence_model = SentenceTransformer('all-MiniLM-L6-v2')
    logger.info("Sentence transformer model loaded successfully")
except Exception as e:
    logger.error(f"Failed to load sentence transformer model: {e}")
    sentence_model = None

def generate_semantic_definitions(texts, clusters, embeddings, pca_components=None):
    """
    Generate semantic definitions for dimensions and clusters using Gemini
    """
    try:
        # Prepare text for Gemini analysis
        analysis_text = "Analyze the following text collection and provide semantic definitions:\n\n"
        
        # Add original dimension info
        analysis_text += "ORIGINAL DIMENSIONS (Text Content):\n"
        for i, text in enumerate(texts[:5]):  # Show first 5 as examples
            analysis_text += f"- Text {i+1}: {text.content[:200]}...\n"
        if len(texts) > 5:
            analysis_text += f"- ... and {len(texts)-5} more texts\n"
        
        # Add PCA dimension info if available
        if pca_components is not None:
            analysis_text += "\nPCA DIMENSIONS (Principal Components):\n"
            for i in range(min(3, len(pca_components))):
                analysis_text += f"- PCA Dimension {i+1}: Represents the {i+1}th principal component of semantic variation\n"
        
        # Add cluster info
        analysis_text += "\nCLUSTERS:\n"
        for cluster in clusters:
            analysis_text += f"\nCluster {cluster.cluster_id} ({cluster.size} items):\n"
            analysis_text += f"Centroid: {cluster.centroid_text}\n"
            analysis_text += "Sample items:\n"
            for item in cluster.items[:3]:  # Show top 3 items
                analysis_text += f"- {item.text[:150]}...\n"
        
        analysis_text += "\n\nPlease provide:\n"
        analysis_text += "1. Semantic definitions for each cluster (what themes/concepts they represent)\n"
        analysis_text += "2. Key themes for each cluster\n"
        analysis_text += "3. Representative examples for each cluster\n"
        analysis_text += "4. Overall interpretation of the clustering results\n"
        
        # Use Gemini to generate semantic definitions
        prompt = f"""
        You are an expert data analyst specializing in semantic analysis and text clustering. 
        Analyze the following clustering results and provide detailed semantic definitions.
        
        {analysis_text}
        
        Provide your response in the following JSON format:
        {{
            "clusters": [
                {{
                    "cluster_id": 0,
                    "semantic_definition": "Description of what this cluster represents semantically",
                    "key_themes": ["theme1", "theme2", "theme3"],
                    "representative_examples": ["example1", "example2"]
                }}
            ],
            "dimensions": [
                {{
                    "dimension_id": 0,
                    "type": "original",
                    "name": "Text Content",
                    "description": "Original text content as input to the clustering algorithm"
                }},
                {{
                    "dimension_id": 1,
                    "type": "pca",
                    "name": "PCA Dimension 1",
                    "description": "First principal component representing the most significant semantic variation",
                    "variance_explained": 0.45,
                    "top_features": ["feature1", "feature2"]
                }}
            ],
            "overall_interpretation": "Overall interpretation of the clustering results and what they reveal about the data"
        }}
        """
        
        response = model.generate_content(prompt)
        result_text = response.text
        
        # Extract JSON from response
        import re
        json_match = re.search(r'\{.*\}', result_text, re.DOTALL)
        if json_match:
            import json
            result = json.loads(json_match.group())
            return result
        else:
            # Fallback: create basic definitions
            return create_fallback_definitions(clusters, pca_components)
            
    except Exception as e:
        logger.error(f"Error generating semantic definitions: {e}")
        return create_fallback_definitions(clusters, pca_components)

def create_fallback_definitions(clusters, pca_components=None):
    """Create basic fallback definitions when Gemini fails"""
    cluster_definitions = []
    for cluster in clusters:
        cluster_definitions.append({
            "cluster_id": cluster.cluster_id,
            "semantic_definition": f"Cluster {cluster.cluster_id} containing {cluster.size} items with centroid: {cluster.centroid_text[:100]}...",
            "key_themes": ["theme1", "theme2"],
            "representative_examples": [item.text[:100] + "..." for item in cluster.items[:2]]
        })
    
    dimensions = [
        {
            "dimension_id": 0,
            "type": "original",
            "name": "Text Content",
            "description": "Original text content as input to the clustering algorithm"
        }
    ]
    
    if pca_components is not None:
        for i in range(min(3, len(pca_components))):
            dimensions.append({
                "dimension_id": i + 1,
                "type": "pca",
                "name": f"PCA Dimension {i+1}",
                "description": f"Principal component {i+1} representing semantic variation",
                "variance_explained": 0.1 + (0.1 * i),  # Placeholder values
                "top_features": [f"feature_{i}_{j}" for j in range(3)]
            })
    
    return {
        "clusters": cluster_definitions,
        "dimensions": dimensions,
        "overall_interpretation": "Clustering analysis completed with basic semantic definitions."
    }

def perform_clustering(texts, method="kmeans", n_clusters=5, eps=0.3, min_samples=2):
    """
    Perform enhanced clustering on a list of texts using sentence transformers with PCA and semantic definitions
    """
    if not sentence_model:
        raise Exception("Sentence transformer model not available")
    
    if not texts:
        raise Exception("No texts provided for clustering")
    
    # Extract text content
    text_list = [text.content for text in texts]
    text_ids = [text.id for text in texts]
    
    # Generate embeddings
    logger.info(f"Generating embeddings for {len(text_list)} texts")
    embeddings = sentence_model.encode(text_list, show_progress_bar=True)
    
    # Perform PCA for dimension reduction and analysis
    pca_components = None
    pca_explained_variance = None
    if len(embeddings) > 1 and embeddings.shape[1] > 1:
        try:
            # Determine optimal number of components
            n_components = min(3, min(embeddings.shape[0], embeddings.shape[1]))
            pca = PCA(n_components=n_components, random_state=42)
            pca_result = pca.fit_transform(embeddings)
            pca_components = pca_result
            pca_explained_variance = float(sum(pca.explained_variance_ratio_))
            logger.info(f"PCA performed with {n_components} components, explained variance: {pca_explained_variance:.3f}")
        except Exception as e:
            logger.warning(f"PCA failed: {e}")
    
    # Perform clustering
    if method.lower() == "kmeans":
        logger.info(f"Performing K-means clustering with {n_clusters} clusters")
        clusterer = KMeans(n_clusters=min(n_clusters, len(texts)), random_state=42)
        cluster_labels = clusterer.fit_predict(embeddings)
        
        # Calculate centroids
        centroids = clusterer.cluster_centers_
        centroid_texts = []
        for i in range(len(centroids)):
            # Find the text closest to the centroid
            distances = np.linalg.norm(embeddings - centroids[i], axis=1)
            closest_idx = np.argmin(distances)
            centroid_texts.append(text_list[closest_idx])
            
    elif method.lower() == "dbscan":
        logger.info(f"Performing DBSCAN clustering with eps={eps}, min_samples={min_samples}")
        clusterer = DBSCAN(eps=eps, min_samples=min_samples)
        cluster_labels = clusterer.fit_predict(embeddings)
        
        # For DBSCAN, use the most representative text from each cluster
        centroid_texts = []
        unique_labels = set(cluster_labels)
        for label in unique_labels:
            if label == -1:  # Noise points
                continue
            cluster_indices = np.where(cluster_labels == label)[0]
            cluster_embeddings = embeddings[cluster_indices]
            cluster_center = np.mean(cluster_embeddings, axis=0)
            distances = np.linalg.norm(cluster_embeddings - cluster_center, axis=1)
            closest_idx = cluster_indices[np.argmin(distances)]
            centroid_texts.append(text_list[closest_idx])
    else:
        raise ValueError(f"Unsupported clustering method: {method}")
    
    # Calculate similarity scores for each item to its cluster centroid
    similarity_scores = []
    for i, label in enumerate(cluster_labels):
        if label == -1:  # Noise point in DBSCAN
            similarity_scores.append(0.0)
        else:
            if method.lower() == "kmeans":
                centroid = centroids[label]
            else:  # DBSCAN
                cluster_indices = np.where(cluster_labels == label)[0]
                cluster_embeddings = embeddings[cluster_indices]
                centroid = np.mean(cluster_embeddings, axis=0)
            
            similarity = cosine_similarity([embeddings[i]], [centroid])[0][0]
            similarity_scores.append(float(similarity))
    
    # Group items by cluster
    clusters = []
    unique_labels = sorted(set(cluster_labels))
    
    for label in unique_labels:
        if label == -1:  # Skip noise points for now
            continue
            
        cluster_indices = np.where(cluster_labels == label)[0]
        cluster_items = []
        
        for idx in cluster_indices:
            cluster_items.append(ClusterItem(
                text_id=text_ids[idx],
                text=text_list[idx],
                cluster_id=int(label),
                similarity_score=similarity_scores[idx]
            ))
        
        # Sort by similarity score (highest first)
        cluster_items.sort(key=lambda x: x.similarity_score, reverse=True)
        
        # Get centroid text
        if method.lower() == "kmeans":
            centroid_text = centroid_texts[label]
        else:
            centroid_idx = unique_labels.index(label)
            centroid_text = centroid_texts[centroid_idx] if centroid_idx < len(centroid_texts) else cluster_items[0].text
        
        clusters.append(ClusterGroup(
            cluster_id=int(label),
            items=cluster_items,
            centroid_text=centroid_text,
            size=len(cluster_items),
            semantic_definition="",  # Will be filled by semantic analysis
            key_themes=[],
            representative_examples=[]
        ))
    
    # Sort clusters by size (largest first)
    clusters.sort(key=lambda x: x.size, reverse=True)
    
    # Generate semantic definitions
    logger.info("Generating semantic definitions...")
    semantic_results = generate_semantic_definitions(texts, clusters, embeddings, pca_components)
    
    # Update clusters with semantic definitions
    for cluster in clusters:
        semantic_cluster = next((c for c in semantic_results["clusters"] if c["cluster_id"] == cluster.cluster_id), None)
        if semantic_cluster:
            cluster.semantic_definition = semantic_cluster["semantic_definition"]
            cluster.key_themes = semantic_cluster["key_themes"]
            cluster.representative_examples = semantic_cluster["representative_examples"]
    
    # Create dimension information
    dimensions = []
    
    # Original dimensions
    dimensions.append(DimensionInfo(
        dimension_id=0,
        type="original",
        name="Text Content",
        description="Original text content as input to the clustering algorithm"
    ))
    
    # PCA dimensions
    if pca_components is not None:
        for i in range(min(3, pca_components.shape[1])):
            pca_dim = next((d for d in semantic_results["dimensions"] if d["type"] == "pca" and d["dimension_id"] == i + 1), None)
            dimensions.append(DimensionInfo(
                dimension_id=i + 1,
                type="pca",
                name=pca_dim["name"] if pca_dim else f"PCA Dimension {i+1}",
                description=pca_dim["description"] if pca_dim else f"Principal component {i+1} representing semantic variation",
                variance_explained=pca_dim.get("variance_explained", 0.1 + (0.1 * i)) if pca_dim else 0.1 + (0.1 * i),
                top_features=pca_dim.get("top_features", [f"feature_{i}_{j}" for j in range(3)]) if pca_dim else [f"feature_{i}_{j}" for j in range(3)]
            ))
    
    # Cluster dimensions
    for i, cluster in enumerate(clusters):
        dimensions.append(DimensionInfo(
            dimension_id=len(dimensions),
            type="cluster",
            name=f"Cluster {cluster.cluster_id}",
            description=cluster.semantic_definition
        ))
    
    return clusters, dimensions, pca_explained_variance

@app.route('/')
def home():
    return jsonify({"message": "PDF Layout Tool API is running"})

@app.after_request
def after_request(response):
    response.headers.add('Access-Control-Allow-Origin', 'http://localhost:5173')
    response.headers.add('Access-Control-Allow-Headers', 'Content-Type,Authorization')
    response.headers.add('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS')
    response.headers.add('Access-Control-Allow-Credentials', 'true')
    return response

@app.route('/api/upload', methods=['POST'])
def upload_file():
    try:
        logger.debug("=== UPLOAD REQUEST ===")
        logger.debug(f"Request method: {request.method}")
        logger.debug(f"Request headers: {dict(request.headers)}")
        
        if 'file' not in request.files:
            logger.error("No file part in request")
            return jsonify({'error': 'No file part'}), 400
            
        file = request.files['file']
        if file.filename == '':
            logger.error("No selected file")
            return jsonify({'error': 'No selected file'}), 400
            
        if file and file.filename.endswith('.pdf'):
            logger.debug(f"Processing file: {file.filename}")
            
            # Save the file
            filename = secure_filename(file.filename)
            timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
            unique_filename = f"{timestamp}_{filename}"
            input_path = os.path.join(app.config['UPLOAD_FOLDER'], unique_filename)
            file.save(input_path)
            logger.debug(f"File saved to: {input_path}")
            
            try:
                # Save document info
                document_id = save_document(unique_filename, filename)
                logger.debug(f"Document saved with ID: {document_id}")
                
                # Process PDF
                doc = fitz.open(input_path)
                logger.debug(f"PDF opened with {len(doc)} pages")
                
                # Process each page
                for page_num in range(len(doc)):
                    page = doc[page_num]
                    logger.debug(f"Processing page {page_num + 1}")
                    
                    # Save page info
                    page_id = save_page(document_id, page_num + 1)
                    logger.debug(f"Page saved with ID: {page_id}")
                    
                    # Get blocks
                    blocks = page.get_text("blocks")
                    logger.debug(f"Found {len(blocks)} blocks on page {page_num + 1}")
                    
                    # Process each block
                    for block_idx, block in enumerate(blocks):
                        # block format: (x0, y0, x1, y1, "text", block_no, block_type)
                        block_bbox = {
                            'x0': block[0],
                            'y0': block[1],
                            'x1': block[2],
                            'y1': block[3]
                        }
                        
                        # Get words in this block
                        words = page.get_text("words", clip=block_bbox)
                        word_positions = []
                        
                        # Common capitalized words that shouldn't be considered sentence starters
                        common_caps = {
                            'I', 'Mr', 'Mrs', 'Ms', 'Dr', 'Prof', 'St', 'Ave', 'Blvd', 'Rd', 'Ln',
                            'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
                            'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'
                        }
                        
                        # Track the last word's text for sentence boundary detection
                        last_word_text = ""
                        
                        for word in words:
                            word_bbox = fitz.Rect(word[:4])
                            if (word_bbox.x0 >= block_bbox['x0'] and 
                                word_bbox.y0 >= block_bbox['y0'] and 
                                word_bbox.x1 <= block_bbox['x1'] and 
                                word_bbox.y1 <= block_bbox['y1']):
                                
                                word_text = word[4] if word[4] else ""
                                
                                # Check if this word could be a sentence starter
                                is_sentence_starter = False
                                if word_text:
                                    # Must start with a capital letter
                                    if word_text[0].isupper():
                                        # Must not be a common capitalized word
                                        if word_text not in common_caps:
                                            # Must be at start of block or after sentence-ending punctuation
                                            if not last_word_text or last_word_text[-1] in '.!?':
                                                is_sentence_starter = True
                                
                                logger.debug(f"Word: '{word_text}', Is sentence starter: {is_sentence_starter}")
                                
                                word_positions.append({
                                    'word': word_text,
                                    'bbox': {
                                        'x0': word[0],
                                        'y0': word[1],
                                        'x1': word[2],
                                        'y1': word[3]
                                    },
                                    'is_sentence_starter': is_sentence_starter
                                })
                                
                                # Update last word text for next iteration
                                last_word_text = word_text
                        
                        # Create block object
                        block_obj = {
                            "id": block_idx + 1,
                            "text": block[4],  # block text
                            "bbox": block_bbox
                        }
                        
                        # Save block to database
                        block_id = save_block(document_id, page_id, block_obj)
                        logger.debug(f"Saved block {block_idx + 1} with ID: {block_id}")
                        
                        # Save words to database
                        if word_positions:
                            save_words(document_id, page_id, block_id, word_positions)
                            logger.debug(f"Saved {len(word_positions)} words for block {block_id}")
                
                doc.close()
                
                # Return success response
                return jsonify({
                    'message': 'File uploaded and processed successfully',
                    'filename': unique_filename,
                    'document_id': document_id
                }), 200
                
            except Exception as e:
                logger.error(f"Error processing PDF: {str(e)}")
                logger.error(f"Error type: {type(e)}")
                logger.error(f"Error traceback:", exc_info=True)
                return jsonify({'error': str(e)}), 500
            finally:
                # Don't clean up the uploaded file since we need it for serving
                pass
        else:
            logger.error("Invalid file type")
            return jsonify({'error': 'Invalid file type'}), 400
            
    except Exception as e:
        logger.error(f"Error handling upload: {str(e)}")
        logger.error(f"Error type: {type(e)}")
        logger.error(f"Error traceback:", exc_info=True)
        return jsonify({'error': str(e)}), 500

@app.route('/api/pdf/<filename>', methods=['GET'])
def get_pdf(filename):
    logger.debug("=== GET PDF REQUEST ===")
    logger.debug(f"Requested filename: {filename}")
    logger.debug(f"Request headers: {dict(request.headers)}")
    
    try:
        filepath = os.path.join(UPLOAD_FOLDER, secure_filename(filename))
        logger.debug(f"Serving file from: {filepath}")
        return send_file(filepath, mimetype='application/pdf')
    except Exception as e:
        logger.error(f"Error serving file: {str(e)}")
        return jsonify({'error': str(e)}), 404

@app.route('/api/blocks/<int:document_id>', methods=['GET'])
def get_blocks(document_id):
    try:
        conn = get_db_connection()
        cursor = conn.cursor()

        # First get the total number of pages for this document
        cursor.execute('''
            SELECT MAX(page_number) as max_page
            FROM pages
            WHERE document_id = ?
        ''', (document_id,))
        result = cursor.fetchone()
        total_pages = result['max_page'] if result and result['max_page'] else 0

        # Get blocks with user_order
        cursor.execute('''
            SELECT b.id, b.page_id, b.block_number, b.text, b.x0, b.y0, b.x1, b.y1, b.user_order, p.page_number
            FROM blocks b
            JOIN pages p ON b.page_id = p.id
            WHERE b.document_id = ?
            ORDER BY p.page_number, b.block_number
        ''', (document_id,))
        blocks = cursor.fetchall()

        # Get word positions
        cursor.execute('''
            SELECT w.word_number, w.page_id, w.block_id, w.text as word, w.x0, w.y0, w.x1, w.y1, w.is_sentence_starter, w.sentence_number, p.page_number, b.block_number
            FROM words w
            JOIN pages p ON w.page_id = p.id
            JOIN blocks b ON w.block_id = b.id
            WHERE w.document_id = ?
            ORDER BY p.page_number, b.block_number, w.word_number
        ''', (document_id,))
        words = cursor.fetchall()

        # Transform blocks data
        transformed_blocks = []
        current_page = None
        page_blocks = []

        # Initialize array with empty arrays for all pages
        transformed_blocks = [[] for _ in range(total_pages)]

        # Fill in the blocks for pages that have them
        for block in blocks:
            page_index = block['page_number'] - 1  # Convert to 0-based index
            transformed_blocks[page_index].append({
                'id': block['block_number'],
                'page_id': block['page_id'],
                'block_id': block['id'],
                'text': block['text'],
                'bbox': {
                    'x0': block['x0'],
                    'y0': block['y0'],
                    'x1': block['x1'],
                    'y1': block['y1']
                },
                'user_order': block['user_order']
            })

        # Transform words data
        transformed_words = [{
            'word_number': word['word_number'],
            'text': word['word'],
            'bbox': {
                'x0': word['x0'],
                'y0': word['y0'],
                'x1': word['x1'],
                'y1': word['y1']
            },
            'is_sentence_starter': bool(word['is_sentence_starter']),
            'sentence_number': word['sentence_number'],
            'page_id': word['page_id'],
            'block_id': word['block_id']
        } for word in words]

        return jsonify({
            'blocks': transformed_blocks,
            'words': transformed_words
        })

    except Exception as e:
        logger.error(f"Error in get_blocks: {str(e)}")
        return jsonify({'error': str(e)}), 500
    finally:
        if conn:
            conn.close()

@app.route('/api/sentences/<int:document_id>', methods=['GET'])
def get_sentences(document_id):
    logger.debug("=== GET SENTENCES REQUEST ===")
    logger.debug(f"Requested document ID: {document_id}")
    
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        
        # First get all sentences with their rhetorical functions
        cursor.execute('''
            SELECT 
                s.sentence_number,
                s.text,
                s.page_id,
                s.block_id,
                s.rhetorical_function,
                s.relevance,
                b.user_order,
                p.page_number,
                b.block_number
            FROM sentences s
            JOIN blocks b ON s.block_id = b.id
            JOIN pages p ON s.page_id = p.id
            WHERE s.document_id = ?
            ORDER BY s.sentence_number
        ''', (document_id,))
        
        sentences = cursor.fetchall()
        logger.debug(f"Found {len(sentences)} sentences in database")
        
        # Transform the sentences into the expected format
        transformed_sentences = [{
            'sentence_number': s['sentence_number'],
            'text': s['text'],
            'block_id': s['block_id'],
            'page_id': s['page_id'],
            'user_order': s['user_order'],
            'page_number': s['page_number'],
            'block_number': s['block_number'],
            'rhetorical_function': s['rhetorical_function'],
            'relevance': s['relevance']
        } for s in sentences]
        
        logger.debug("=== SENTENCES BEING RETURNED ===")
        for sentence in transformed_sentences:
            logger.debug(f"Sentence {sentence['sentence_number']}:")
            logger.debug(f"  Text: {sentence['text']}")
            logger.debug(f"  Function: {sentence['rhetorical_function']}")
            logger.debug(f"  Relevance: {sentence['relevance']}")
            logger.debug(f"  Block: {sentence['block_number']} (Order: {sentence['user_order']})")
            logger.debug(f"  Page: {sentence['page_number']}")
        
        return jsonify({'sentences': transformed_sentences})
    except Exception as e:
        logger.error(f"Error serving sentences: {str(e)}")
        return jsonify({'error': str(e)}), 500
    finally:
        if conn:
            conn.close()

@app.route('/api/process-text', methods=['POST'])
def process_text():
    try:
        # Check if API key is configured
        if not os.getenv('GOOGLE_API_KEY'):
            logger.error("Process-text endpoint called but GOOGLE_API_KEY is not configured")
            return jsonify({'error': 'Gemini processing is not configured. Please set up the API key.'}), 503
        
        logger.debug("=== PROCESS TEXT REQUEST ===")
        logger.debug(f"Request method: {request.method}")
        logger.debug(f"Request headers: {dict(request.headers)}")
        
        data = request.get_json()
        document_id = data.get('document_id')
        
        if not document_id:
            logger.error("Missing document_id in request")
            return jsonify({'error': 'Missing document_id'}), 400

        # Get sentences from database
        conn = get_db_connection()
        cursor = conn.cursor()
        
        try:
            # First check if we have any activated blocks
            cursor.execute('''
                SELECT COUNT(*) as count
                FROM blocks
                WHERE document_id = ? AND user_order IS NOT NULL
            ''', (document_id,))
            activated_blocks = cursor.fetchone()['count']
            logger.debug(f"Found {activated_blocks} activated blocks for document {document_id}")

            if activated_blocks == 0:
                logger.error(f"No activated blocks found for document {document_id}")
                return jsonify({'error': 'No activated blocks found. Please activate some blocks first.'}), 400

            # Get all sentences for the document
            cursor.execute('''
                SELECT s.id, s.sentence_number, s.text, s.page_id, s.block_id,
                       b.user_order, p.page_number
                FROM sentences s
                JOIN blocks b ON s.block_id = b.id
                JOIN pages p ON s.page_id = p.id
                WHERE s.document_id = ?
                ORDER BY b.user_order, s.sentence_number
            ''', (document_id,))
            
            sentences = cursor.fetchall()
            logger.debug(f"Found {len(sentences)} sentences in database for document {document_id}")
            
            if not sentences:
                # If no sentences found, try to sync them from words table
                logger.debug("No sentences found, attempting to sync from words table")
                if not sync_sentences(document_id):
                    # Check if there are any sentence starters
                    cursor.execute('''
                        SELECT COUNT(*) as count
                        FROM words
                        WHERE document_id = ? AND is_sentence_starter = 1
                    ''', (document_id,))
                    sentence_starters = cursor.fetchone()['count']
                    
                    if sentence_starters == 0:
                        logger.error(f"No sentence starters found for document {document_id}")
                        return jsonify({'error': 'No sentence starters found. Please mark some words as sentence starters first.'}), 400
                    else:
                        logger.error(f"Failed to sync sentences for document {document_id}")
                        return jsonify({'error': 'Failed to sync sentences. Please try resetting sentence numbers first.'}), 400
                
                # Check again after sync
                cursor.execute('''
                    SELECT s.id, s.sentence_number, s.text, s.page_id, s.block_id,
                           b.user_order, p.page_number
                    FROM sentences s
                    JOIN blocks b ON s.block_id = b.id
                    JOIN pages p ON s.page_id = p.id
                    WHERE s.document_id = ?
                    ORDER BY b.user_order, s.sentence_number
                ''', (document_id,))
                
                sentences = cursor.fetchall()
                logger.debug(f"After sync: Found {len(sentences)} sentences for document {document_id}")
                
                if not sentences:
                    logger.error(f"No sentences found after sync for document {document_id}")
                    return jsonify({'error': 'No sentences found for document'}), 404

            # Process with Gemini
            try:
                # Prepare the prompt
                sentences_data = [{'sentence_number': s['sentence_number'], 'text': s['text']} for s in sentences]
                prompt = f"""I will give you a sequence of sentences extracted from an academic article/book. Please analyze these sentences and identify their rhetorical functions in the context of the article/book. Return ONLY a JSON array of objects, where each object has:
                - sentence_number: must match the provided number
                - rhetorical_function: 1-3 keywords (e.g., Introduction, Background, Method, Results, Discussion, Conclusion) + colon (:) + 5-10 word added details
                - relevance: score from 0-100

                Example response format:
                [
                  {{
                    "sentence_number": 1,
                    "rhetorical_function": "Introduction: Establishes the context and scope of the research",
                    "relevance": 90
                  }}
                ]

                DO NOT include any explanatory text before or after the JSON array.
                DO NOT use markdown formatting.
                Return ONLY the JSON array.

                Sentences to analyze:
                {json.dumps(sentences_data, indent=2)}
                """

                logger.debug("=== GEMINI REQUEST ===")
                logger.debug(f"Number of sentences to analyze: {len(sentences)}")
                logger.debug("Raw sentences data:")
                for s in sentences_data:
                    logger.debug(f"Sentence {s['sentence_number']}: {s['text']}")
                logger.debug("Complete prompt:")
                logger.debug(prompt)

                # Get response from Gemini
                response = model.generate_content(prompt)
                response_text = response.text
                logger.debug("=== GEMINI RESPONSE ===")
                logger.debug("Raw response text:")
                logger.debug(response_text)

                # Clean the response text - remove any non-JSON text
                response_text = response_text.strip()
                # Find the first [ and last ]
                start_idx = response_text.find('[')
                end_idx = response_text.rfind(']') + 1
                if start_idx >= 0 and end_idx > start_idx:
                    response_text = response_text[start_idx:end_idx]
                    logger.debug("Cleaned response text:")
                    logger.debug(response_text)
                else:
                    logger.error("No valid JSON array found in response")
                    raise ValueError("No valid JSON array found in response")

                # Parse the cleaned response
                try:
                    results = json.loads(response_text)
                    logger.debug(f"Parsed {len(results)} results from Gemini")
                    logger.debug("Parsed results:")
                    for result in results:
                        logger.debug(f"Sentence {result['sentence_number']}:")
                        logger.debug(f"  Function: {result['rhetorical_function']}")
                        logger.debug(f"  Relevance: {result['relevance']}")
                    
                    # Verify all sentences are included in results
                    sentence_numbers = {s['sentence_number'] for s in sentences}
                    result_numbers = {r['sentence_number'] for r in results}
                    missing_numbers = sentence_numbers - result_numbers
                    
                    if missing_numbers:
                        logger.warning(f"Missing sentence numbers in Gemini response: {missing_numbers}")
                        # Add missing sentences with default values
                        for num in missing_numbers:
                            results.append({
                                'sentence_number': num,
                                'rhetorical_function': 'Unknown: Missing from analysis',
                                'relevance': 0
                            })
                        logger.debug("Updated results after adding missing sentences:")
                        for result in results:
                            logger.debug(f"Sentence {result['sentence_number']}:")
                            logger.debug(f"  Function: {result['rhetorical_function']}")
                            logger.debug(f"  Relevance: {result['relevance']}")
                    
                    # Update sentences table with analysis results
                    for result in results:
                        cursor.execute('''
                            UPDATE sentences
                            SET rhetorical_function = ?,
                                relevance = ?
                            WHERE document_id = ? AND sentence_number = ?
                        ''', (result['rhetorical_function'], result['relevance'],
                              document_id, result['sentence_number']))
                    
                    conn.commit()
                    logger.debug("Updated sentences table with Gemini results")
                    
                    # Add page_id and block_id to each result
                    for result in results:
                        sentence = next(s for s in sentences if s['sentence_number'] == result['sentence_number'])
                        result['page_id'] = sentence['page_id']
                        result['block_id'] = sentence['block_id']

                    return jsonify({'results': results})

                except json.JSONDecodeError as e:
                    logger.error(f"Failed to parse Gemini response as JSON: {str(e)}")
                    logger.error(f"Response text: {response_text}")
                    return jsonify({'error': 'Invalid response format from Gemini'}), 500

            except Exception as e:
                logger.error(f"Failed to process with Gemini: {str(e)}")
                logger.error("Error traceback:", exc_info=True)
                return jsonify({'error': str(e)}), 500

        except Exception as e:
            conn.rollback()
            logger.error(f"Database error: {str(e)}")
            return jsonify({'error': str(e)}), 500
        finally:
            conn.close()

    except Exception as e:
        logger.error(f"Error processing text: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/add-custom-sentence', methods=['POST'])
def add_custom_sentence():
    logger.debug("=== ADD CUSTOM SENTENCE REQUEST ===")
    logger.debug(f"Request method: {request.method}")
    logger.debug(f"Request headers: {dict(request.headers)}")
    
    try:
        data = request.get_json()
        logger.debug("Received data:")
        logger.debug(json.dumps(data, indent=2))
        
        # Log each required field
        required_fields = ['document_id', 'page_id', 'block_id', 'word', 'position']
        logger.debug("Checking required fields:")
        for field in required_fields:
            logger.debug(f"Field '{field}': {'present' if field in data else 'missing'}")
            if field in data:
                logger.debug(f"Value: {json.dumps(data[field], indent=2)}")
        
        if not data or not all(k in data for k in required_fields):
            missing_fields = [field for field in required_fields if field not in data]
            error_msg = f"Missing required fields: {', '.join(missing_fields)}"
            logger.error(error_msg)
            return jsonify({'error': error_msg}), 400

        document_id = data['document_id']
        page_id = data['page_id']
        block_id = data['block_id']
        word = data['word']
        position = data['position']

        logger.debug("Processing request with:")
        logger.debug(f"document_id: {document_id}")
        logger.debug(f"page_id: {page_id}")
        logger.debug(f"block_id: {block_id}")
        logger.debug(f"word: {json.dumps(word, indent=2)}")
        logger.debug(f"position: {json.dumps(position, indent=2)}")

        # Get database connection
        conn = get_db_connection()
        cursor = conn.cursor()

        # Get the next sentence number for this block
        cursor.execute('''
            SELECT MAX(sentence_number) 
            FROM sentences 
            WHERE document_id = ? AND page_id = ? AND block_id = ?
        ''', (document_id, page_id, block_id))
        max_sentence_num = cursor.fetchone()[0] or 0
        new_sentence_num = max_sentence_num + 1
        
        logger.debug(f"New sentence number: {new_sentence_num}")

        # Insert the new sentence
        cursor.execute('''
            INSERT INTO sentences (
                document_id, 
                page_id, 
                block_id, 
                sentence_number, 
                text
            ) VALUES (?, ?, ?, ?, ?)
        ''', (
            document_id,
            page_id,
            block_id,
            new_sentence_num,
            word['text']
        ))
        conn.commit()
        conn.close()
        
        logger.debug("Successfully added custom sentence")
        return jsonify({
            'message': 'Custom sentence added successfully',
            'sentence_number': new_sentence_num
        }), 200

    except Exception as e:
        logger.error(f"Error adding custom sentence: {str(e)}")
        logger.error(f"Error type: {type(e)}")
        logger.error(f"Error details: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/remove-custom-sentence', methods=['POST'])
def remove_custom_sentence():
    try:
        data = request.get_json()
        print("Received data:", data)
        
        # Validate required fields
        required_fields = ['document_id', 'page_id', 'block_id', 'sentence_number']
        for field in required_fields:
            if field not in data:
                return jsonify({'error': f'Missing required field: {field}'}), 400
        
        document_id = data['document_id']
        page_id = data['page_id']
        block_id = data['block_id']
        sentence_number = data['sentence_number']
        
        # Get database connection
        conn = get_db_connection()
        cursor = conn.cursor()
        
        try:
            # Delete the sentence
            cursor.execute('''
                DELETE FROM sentences 
                WHERE document_id = ? 
                AND page_id = ? 
                AND block_id = ? 
                AND sentence_number = ?
            ''', (document_id, page_id, block_id, sentence_number))
            
            conn.commit()
            
            return jsonify({
                'message': 'Custom sentence removed successfully',
                'document_id': document_id,
                'page_id': page_id,
                'block_id': block_id,
                'sentence_number': sentence_number
            })
            
        except Exception as e:
            print(f"Database error: {str(e)}")
            return jsonify({'error': f'Database error: {str(e)}'}), 500
        finally:
            conn.close()
            
    except Exception as e:
        print(f"Error removing custom sentence: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/reinitialize-db', methods=['POST'])
def reinitialize_database():
    try:
        reinitialize_db()
        return jsonify({'message': 'Database reinitialized successfully'}), 200
    except Exception as e:
        logger.error(f"Error reinitializing database: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/reset-sentence-numbers', methods=['POST'])
def reset_sentence_numbers_endpoint():
    try:
        data = request.get_json()
        if not data or 'document_id' not in data:
            return jsonify({'error': 'No document_id provided'}), 400
            
        document_id = data['document_id']
        logger.debug(f"Resetting sentence numbers for document {document_id}")
        
        # Reset all sentence numbers to NULL for the document
        conn = get_db_connection()
        cursor = conn.cursor()
        try:
            # Reset all sentence numbers to NULL
            cursor.execute('''
                UPDATE words 
                SET sentence_number = NULL 
                WHERE document_id = ?
            ''', (document_id,))
            
            # Get all activated blocks in user-defined order
            cursor.execute('''
                SELECT b.id as block_id, b.block_number, p.id as page_id, p.page_number
                FROM blocks b
                JOIN pages p ON b.page_id = p.id
                WHERE b.document_id = ? AND b.user_order IS NOT NULL
                ORDER BY b.user_order
            ''', (document_id,))
            blocks = cursor.fetchall()
            
            # Assign sequential sentence numbers
            current_sentence_number = 1
            for block in blocks:
                # Get all sentence starters in this block
                cursor.execute('''
                    SELECT id, word_number
                    FROM words
                    WHERE document_id = ? 
                    AND page_id = ? 
                    AND block_id = ? 
                    AND is_sentence_starter = 1
                    ORDER BY word_number
                ''', (document_id, block['page_id'], block['block_id']))
                sentence_starters = cursor.fetchall()
                
                # Update sentence numbers for this block
                for starter in sentence_starters:
                    cursor.execute('''
                        UPDATE words
                        SET sentence_number = ?
                        WHERE id = ?
                    ''', (current_sentence_number, starter['id']))
                    current_sentence_number += 1
            
            conn.commit()
            
            # Sync sentences table with updated sentence numbers
            sync_sentences(document_id)
            
            return jsonify({'message': 'Sentence numbers reset successfully'}), 200
            
        except Exception as e:
            conn.rollback()
            logger.error(f"Database error in reset_sentence_numbers: {str(e)}")
            raise e
        finally:
            conn.close()
            
    except Exception as e:
        logger.error(f"Error resetting sentence numbers: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/activate-block', methods=['POST'])
def activate_block():
    try:
        data = request.get_json()
        document_id = data.get('document_id')
        page_number = data.get('page_number')
        block_number = data.get('block_number')
        is_activating = data.get('is_activating')  # True for activation, False for deactivation

        conn = get_db_connection()
        cursor = conn.cursor()

        if is_activating:
            # Get the next available user_order
            cursor.execute('''
                SELECT MAX(user_order) as max_order
                FROM blocks
                WHERE document_id = ? AND user_order IS NOT NULL
            ''', (document_id,))
            result = cursor.fetchone()
            next_order = (result['max_order'] or 0) + 1

            # Update the block with the new user_order
            cursor.execute('''
                UPDATE blocks
                SET user_order = ?
                WHERE document_id = ? 
                AND page_id IN (SELECT id FROM pages WHERE document_id = ? AND page_number = ?)
                AND block_number = ?
            ''', (next_order, document_id, document_id, page_number, block_number))
        else:
            # Get the user_order of the block being deactivated
            cursor.execute('''
                SELECT user_order
                FROM blocks
                WHERE document_id = ? 
                AND page_id IN (SELECT id FROM pages WHERE document_id = ? AND page_number = ?)
                AND block_number = ?
            ''', (document_id, document_id, page_number, block_number))
            result = cursor.fetchone()
            if result and result['user_order']:
                deactivated_order = result['user_order']
                
                # Set the deactivated block's user_order to NULL
                cursor.execute('''
                    UPDATE blocks
                    SET user_order = NULL
                    WHERE document_id = ? 
                    AND page_id IN (SELECT id FROM pages WHERE document_id = ? AND page_number = ?)
                    AND block_number = ?
                ''', (document_id, document_id, page_number, block_number))

                # Decrement user_order for all blocks with higher order
                cursor.execute('''
                    UPDATE blocks
                    SET user_order = user_order - 1
                    WHERE document_id = ? AND user_order > ?
                ''', (document_id, deactivated_order))

        conn.commit()
        return jsonify({'success': True})

    except Exception as e:
        logger.error(f"Error in activate_block: {str(e)}")
        return jsonify({'error': str(e)}), 500
    finally:
        if conn:
            conn.close()

@app.route('/api/toggle-sentence-starter', methods=['POST'])
def toggle_sentence_starter():
    try:
        data = request.get_json()
        logger.debug("=== TOGGLE SENTENCE STARTER REQUEST ===")
        logger.debug(f"Request data: {json.dumps(data, indent=2)}")
        
        # Validate required fields
        required_fields = ['document_id', 'page_id', 'block_id', 'word_number']
        if not all(field in data for field in required_fields):
            missing = [f for f in required_fields if f not in data]
            return jsonify({'error': f'Missing required fields: {", ".join(missing)}'}), 400

        document_id = data['document_id']
        page_id = data['page_id']
        block_id = data['block_id']
        word_number = data['word_number']

        conn = get_db_connection()
        cursor = conn.cursor()
        
        try:
            # First, verify the word exists
            cursor.execute('''
                SELECT id, word_number, text, is_sentence_starter
                FROM words
                WHERE document_id = ? 
                AND page_id = ? 
                AND block_id = ? 
                AND word_number = ?
            ''', (document_id, page_id, block_id, word_number))
            word = cursor.fetchone()
            
            if not word:
                logger.error(f"Word not found: document_id={document_id}, page_id={page_id}, block_id={block_id}, word_number={word_number}")
                return jsonify({'error': 'Word not found'}), 404
                
            logger.debug(f"Found word: {dict(word)}")
            
            # Toggle the is_sentence_starter status
            cursor.execute('''
                UPDATE words 
                SET is_sentence_starter = NOT is_sentence_starter,
                    sentence_number = CASE 
                        WHEN is_sentence_starter = 0 THEN NULL 
                        ELSE sentence_number 
                    END
                WHERE id = ?
            ''', (word['id'],))
            
            # Get all activated blocks in user-defined order
            cursor.execute('''
                SELECT b.id as block_id, b.page_id, p.page_number
                FROM blocks b
                JOIN pages p ON b.page_id = p.id
                WHERE b.document_id = ? AND b.user_order IS NOT NULL
                ORDER BY b.user_order
            ''', (document_id,))
            activated_blocks = cursor.fetchall()
            
            logger.debug(f"Found {len(activated_blocks)} activated blocks")
            
            # Get all sentence starters across all activated blocks
            cursor.execute('''
                SELECT w.id, w.word_number, w.text, w.is_sentence_starter, b.user_order, p.page_number
                FROM words w
                JOIN blocks b ON w.block_id = b.id
                JOIN pages p ON w.page_id = p.id
                WHERE w.document_id = ? 
                AND b.user_order IS NOT NULL
                AND w.is_sentence_starter = 1
                ORDER BY b.user_order, w.word_number
            ''', (document_id,))
            sentence_starters = cursor.fetchall()
            
            logger.debug(f"Found {len(sentence_starters)} sentence starters across all blocks")
            
            # First, reset all sentence numbers to NULL
            cursor.execute('''
                UPDATE words
                SET sentence_number = NULL
                WHERE document_id = ?
                AND is_sentence_starter = 1
            ''', (document_id,))
            
            # Then update sentence numbers for all sentence starters
            for idx, starter in enumerate(sentence_starters, 1):
                cursor.execute('''
                    UPDATE words
                    SET sentence_number = ?
                    WHERE id = ?
                ''', (idx, starter['id']))
            
            conn.commit()
            
            # Sync sentences table with updated sentence numbers
            sync_sentences(document_id)
            
            # Get updated word data for all activated blocks
            cursor.execute('''
                SELECT w.word_number, w.text, w.is_sentence_starter, w.sentence_number, w.x0, w.y0, w.x1, w.y1,
                       w.page_id, w.block_id
                FROM words w
                JOIN blocks b ON w.block_id = b.id
                WHERE w.document_id = ? 
                AND b.user_order IS NOT NULL
                ORDER BY b.user_order, w.word_number
            ''', (document_id,))
            updated_words = cursor.fetchall()
            
            logger.debug(f"Found {len(updated_words)} words in activated blocks")
            
            # Transform the words data to include bbox
            transformed_words = [{
                'word_number': word['word_number'],
                'text': word['text'],
                'is_sentence_starter': bool(word['is_sentence_starter']),
                'sentence_number': word['sentence_number'],
                'bbox': {
                    'x0': word['x0'],
                    'y0': word['y0'],
                    'x1': word['x1'],
                    'y1': word['y1']
                },
                'page_id': word['page_id'],
                'block_id': word['block_id']
            } for word in updated_words]
            
            logger.debug(f"Transformed {len(transformed_words)} words")
            logger.debug(f"First few transformed words: {json.dumps(transformed_words[:3], indent=2)}")
            
            return jsonify({
                'message': 'Sentence starter toggled successfully',
                'words': transformed_words
            }), 200
            
        except Exception as e:
            conn.rollback()
            logger.error(f"Database error: {str(e)}")
            logger.error("Error traceback:", exc_info=True)
            return jsonify({'error': f'Database error: {str(e)}'}), 500
        finally:
            conn.close()
            
    except Exception as e:
        logger.error(f"Error toggling sentence starter: {str(e)}")
        logger.error("Error traceback:", exc_info=True)
        return jsonify({'error': str(e)}), 500

@app.route('/api/chat', methods=['POST'])
def chat():
    try:
        # Check if API key is configured
        if not os.getenv('GOOGLE_API_KEY'):
            logger.error("Chat endpoint called but GOOGLE_API_KEY is not configured")
            return jsonify({'error': 'Chat functionality is not configured. Please set up the API key.'}), 503
        
        logger.debug("=== CHAT REQUEST ===")
        logger.debug(f"Request method: {request.method}")
        logger.debug(f"Request headers: {dict(request.headers)}")
        
        data = request.get_json()
        logger.debug(f"Request data: {json.dumps(data, indent=2)}")
        
        message = data.get('message')
        sentences = data.get('sentences', [])
        
        logger.debug(f"Message: {message}")
        logger.debug(f"Number of sentences: {len(sentences)}")
        
        if not message:
            logger.error("No message provided")
            return jsonify({'error': 'No message provided'}), 400
        
        if not sentences:
            logger.error("No sentences provided")
            return jsonify({'error': 'No sentences provided'}), 400
        
        # Create context from sentences
        context = "\n".join([f"Sentence {s['sentence_number']}: {s['text']}" for s in sentences])
        logger.debug(f"Context length: {len(context)} characters")
        
        # Create prompt
        prompt = f"""You are an AI assistant helping analyze a document. You have access to the following sentences from the document:

{context}

User question: {message}

Please provide a structured response with:
1. A direct answer to the user's question
2. The most relevant sentences that support your answer (with relevance scores 0-100)
3. An overall relevance score for your response (0-100)
4. A brief explanation of your reasoning

Format your response as JSON with the following structure:
{{
    "answer": "Your direct answer here",
    "relevant_sentences": [
        {{
            "sentence_number": 1,
            "text": "sentence text",
            "relevance_score": 85.5
        }}
    ],
    "overall_relevance_score": 78.2,
    "explanation": "Brief explanation of your reasoning"
}}"""

        logger.debug("=== GEMINI REQUEST ===")
        logger.debug(f"Prompt length: {len(prompt)} characters")
        logger.debug("Prompt preview (first 500 chars):")
        logger.debug(prompt[:500])

        # Generate response with retry logic
        max_retries = 3
        for attempt in range(max_retries):
            try:
                logger.debug(f"Attempt {attempt + 1} of {max_retries}")
                response = model.generate_content(prompt)
                response_text = response.text.strip()
                
                logger.debug("=== GEMINI RESPONSE ===")
                logger.debug(f"Response length: {len(response_text)} characters")
                logger.debug("Raw response:")
                logger.debug(response_text)
                
                # Try to parse JSON response
                try:
                    # Extract JSON from response if it's wrapped in markdown
                    if response_text.startswith('```json'):
                        response_text = response_text.split('```json')[1].split('```')[0].strip()
                        logger.debug("Extracted JSON from ```json``` block")
                    elif response_text.startswith('```'):
                        response_text = response_text.split('```')[1].strip()
                        logger.debug("Extracted JSON from ``` block")
                    
                    logger.debug("Cleaned response text:")
                    logger.debug(response_text)
                    
                    parsed_response = json.loads(response_text)
                    logger.debug("Successfully parsed JSON response")
                    logger.debug(f"Parsed response keys: {list(parsed_response.keys())}")
                    
                    # Validate response structure
                    required_keys = ['answer', 'relevant_sentences', 'overall_relevance_score', 'explanation']
                    missing_keys = [key for key in required_keys if key not in parsed_response]
                    
                    if missing_keys:
                        logger.error(f"Missing required fields in response: {missing_keys}")
                        raise ValueError(f"Missing required fields in response: {missing_keys}")
                    
                    logger.debug("Response validation passed")
                    logger.debug("=== CHAT RESPONSE SUCCESS ===")
                    return jsonify(parsed_response)
                    
                except (json.JSONDecodeError, ValueError) as e:
                    logger.warning(f"Failed to parse JSON response (attempt {attempt + 1}): {e}")
                    logger.warning(f"Response text: {response_text}")
                    
                    if attempt == max_retries - 1:
                        # On final attempt, return a fallback response
                        logger.error("All retry attempts failed, returning fallback response")
                        return jsonify({
                            "answer": "I apologize, but I'm having trouble processing the document content. Please try rephrasing your question.",
                            "relevant_sentences": [],
                            "overall_relevance_score": 0,
                            "explanation": "Unable to parse AI response properly."
                        })
                    continue
                    
            except ResourceExhausted as e:
                logger.warning(f"Resource exhausted (attempt {attempt + 1}): {e}")
                if attempt == max_retries - 1:
                    logger.error("All retry attempts failed due to resource exhaustion")
                    return jsonify({'error': 'Service temporarily unavailable. Please try again later.'}), 503
                time.sleep(2 ** attempt)  # Exponential backoff
            except Exception as e:
                logger.error(f"Error generating response (attempt {attempt + 1}): {e}")
                logger.error(f"Error type: {type(e)}")
                logger.error("Error traceback:", exc_info=True)
                if attempt == max_retries - 1:
                    logger.error("All retry attempts failed")
                    return jsonify({'error': 'Failed to generate response'}), 500
                time.sleep(1)
        
        # If we get here, all retries were exhausted
        logger.error("All retry attempts exhausted without success")
        return jsonify({'error': 'Failed to generate response after all retries'}), 500
        
    except Exception as e:
        logger.error(f"Error in chat endpoint: {e}")
        logger.error(f"Error type: {type(e)}")
        logger.error("Error traceback:", exc_info=True)
        return jsonify({'error': 'Internal server error'}), 500

@app.route('/api/documents', methods=['GET'])
def list_documents():
    """List all uploaded documents with their metadata."""
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        
        cursor.execute('''
            SELECT 
                id,
                filename,
                original_filename,
                created_at,
                (SELECT COUNT(*) FROM pages WHERE document_id = documents.id) as page_count,
                (SELECT COUNT(*) FROM blocks WHERE document_id = documents.id AND user_order IS NOT NULL) as activated_blocks,
                (SELECT COUNT(*) FROM sentences WHERE document_id = documents.id) as sentence_count
            FROM documents 
            ORDER BY created_at DESC
        ''')
        
        documents = []
        for row in cursor.fetchall():
            # Check if file exists
            file_path = os.path.join(app.config['UPLOAD_FOLDER'], row['filename'])
            file_exists = os.path.exists(file_path)
            
            documents.append({
                'id': row['id'],
                'filename': row['filename'],
                'original_filename': row['original_filename'],
                'created_at': row['created_at'],
                'page_count': row['page_count'],
                'activated_blocks': row['activated_blocks'],
                'sentence_count': row['sentence_count'],
                'file_exists': file_exists,
                'file_size': os.path.getsize(file_path) if file_exists else 0
            })
        
        conn.close()
        return jsonify({'documents': documents})
        
    except Exception as e:
        logger.error(f"Error listing documents: {e}")
        return jsonify({'error': 'Failed to list documents'}), 500

@app.route('/api/documents/<int:document_id>', methods=['GET'])
def get_document(document_id):
    """Get detailed information about a specific document."""
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        
        cursor.execute('''
            SELECT 
                id,
                filename,
                original_filename,
                created_at
            FROM documents 
            WHERE id = ?
        ''', (document_id,))
        
        row = cursor.fetchone()
        if not row:
            return jsonify({'error': 'Document not found'}), 404
        
        # Get additional stats
        cursor.execute('SELECT COUNT(*) as count FROM pages WHERE document_id = ?', (document_id,))
        page_count = cursor.fetchone()['count']
        
        cursor.execute('SELECT COUNT(*) as count FROM blocks WHERE document_id = ? AND user_order IS NOT NULL', (document_id,))
        activated_blocks = cursor.fetchone()['count']
        
        cursor.execute('SELECT COUNT(*) as count FROM sentences WHERE document_id = ?', (document_id,))
        sentence_count = cursor.fetchone()['count']
        
        # Check if file exists
        file_path = os.path.join(app.config['UPLOAD_FOLDER'], row['filename'])
        file_exists = os.path.exists(file_path)
        
        document_info = {
            'id': row['id'],
            'filename': row['filename'],
            'original_filename': row['original_filename'],
            'created_at': row['created_at'],
            'page_count': page_count,
            'activated_blocks': activated_blocks,
            'sentence_count': sentence_count,
            'file_exists': file_exists,
            'file_size': os.path.getsize(file_path) if file_exists else 0
        }
        
        conn.close()
        return jsonify(document_info)
        
    except Exception as e:
        logger.error(f"Error getting document: {e}")
        return jsonify({'error': 'Failed to get document'}), 500

@app.route('/api/documents/<int:document_id>', methods=['DELETE'])
def delete_document(document_id):
    """Delete a document and all its associated data."""
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        
        # Get document filename
        cursor.execute('SELECT filename FROM documents WHERE id = ?', (document_id,))
        row = cursor.fetchone()
        if not row:
            return jsonify({'error': 'Document not found'}), 404
        
        filename = row['filename']
        
        # Delete from database (cascade will handle related records)
        cursor.execute('DELETE FROM documents WHERE id = ?', (document_id,))
        
        # Delete file from filesystem
        file_path = os.path.join(app.config['UPLOAD_FOLDER'], filename)
        if os.path.exists(file_path):
            os.remove(file_path)
        
        conn.commit()
        conn.close()
        
        return jsonify({'message': 'Document deleted successfully'})
        
    except Exception as e:
        logger.error(f"Error deleting document: {e}")
        return jsonify({'error': 'Failed to delete document'}), 500

@app.route('/api/documents/<int:document_id>/rename', methods=['PUT'])
def rename_document(document_id):
    """Rename a document's display name."""
    try:
        data = request.get_json()
        new_name = data.get('new_name')
        
        if not new_name or not new_name.strip():
            return jsonify({'error': 'New name is required'}), 400
        
        conn = get_db_connection()
        cursor = conn.cursor()
        
        # Update the original_filename (display name)
        cursor.execute('''
            UPDATE documents 
            SET original_filename = ? 
            WHERE id = ?
        ''', (new_name.strip(), document_id))
        
        if cursor.rowcount == 0:
            return jsonify({'error': 'Document not found'}), 404
        
        conn.commit()
        conn.close()
        
        return jsonify({'message': 'Document renamed successfully'})
        
    except Exception as e:
        logger.error(f"Error renaming document: {e}")
        return jsonify({'error': 'Failed to rename document'}), 500

@app.route('/api/analyze', methods=['POST'])
def analyze_texts():
    def process_batch(batch, question):
        # Helper to process a batch, recursively splitting if Gemini response is too long/incomplete
        logger = app.logger
        batch_context = "\n\n".join([
            f"Text {text['id']}: {text['content']}"
            for text in batch
        ])
        prompt = f'''Analyze the following texts in response to this question: "{question}"

{batch_context}

For each text, provide:
1. A direct answer to the question based on that text
2. Specific quotes from the text that support your answer
3. A brief summary of the text's relevance
4. Relevance score (0-100) for each reference

Provide your response as a JSON array where each element corresponds to one text input.'''
        logger.debug(f"Sending batch of {len(batch)} to Gemini...")
        response = model.generate_content(
            prompt,
            generation_config={
                "temperature": 0.1,
                "max_output_tokens": 4096,
                "response_mime_type": "application/json",
                "response_schema": GridAnalysisResponse
            }
        )
        logger.debug("Received batch response from Gemini")
        try:
            # Try to use the parsed response first
            if hasattr(response, 'parsed') and response.parsed:
                batch_result = response.parsed
                logger.debug("Using parsed structured response")
            else:
                import json
                batch_result = json.loads(response.text)
                logger.debug("Using manually parsed response")
            logger.debug(f"Batch result: {batch_result}")
            # Add batch results to all analyses
            if hasattr(batch_result, 'analyses'):
                return list(batch_result.analyses)
            elif 'analyses' in batch_result:
                return list(batch_result['analyses'])
            else:
                return list(batch_result)
        except Exception as parse_error:
            logger.error(f"Error parsing batch response: {parse_error}")
            logger.error(f"Raw batch response text: {response.text}")
            # If batch size > 1, split and retry recursively
            if len(batch) > 1:
                mid = len(batch) // 2
                logger.warning(f"Splitting batch of {len(batch)} into {len(batch[:mid])} and {len(batch[mid:])}")
                return process_batch(batch[:mid], question) + process_batch(batch[mid:], question)
            else:
                # Only one text, mark as error
                return [{
                    'text_id': batch[0]['id'],
                    'answer': 'Error processing this text.',
                    'references': [],
                    'summary': 'Processing error occurred.'
                }]

    try:
        logger = app.logger
        logger.debug("=== GRID ANALYSIS REQUEST ===")
        data = request.get_json()
        # Validate request data
        if not data or 'texts' not in data or 'question' not in data:
            return jsonify({'error': 'Missing required fields: texts and question'}), 400
        texts = data['texts']
        question = data['question']
        if not texts or not question.strip():
            return jsonify({'error': 'Texts and question cannot be empty'}), 400
        logger.debug(f"Question: {question}")
        logger.debug(f"Number of texts: {len(texts)}")
        batch_size = 10
        all_analyses = []
        for i in range(0, len(texts), batch_size):
            batch = texts[i:i + batch_size]
            results = process_batch(batch, question)
            all_analyses.extend(results)
        logger.debug(f"Total analyses generated: {len(all_analyses)}")
        return jsonify({'analyses': all_analyses})
    except Exception as e:
        logger.error(f"Error in analyze endpoint: {e}")
        return jsonify({'error': str(e)}), 500

# Session management endpoints
@app.route('/api/sessions', methods=['GET'])
def list_sessions():
    """Get all sessions."""
    try:
        sessions = get_sessions()
        return jsonify({'sessions': sessions})
    except Exception as e:
        logger.error(f"Error listing sessions: {e}")
        return jsonify({'error': 'Failed to list sessions'}), 500

@app.route('/api/sessions', methods=['POST'])
def create_new_session():
    """Create a new session."""
    try:
        data = request.get_json()
        name = data.get('name', '').strip()
        description = data.get('description', '').strip()
        
        if not name:
            return jsonify({'error': 'Session name is required'}), 400
        
        session_id = create_session(name, description)
        session = get_session(session_id)
        
        return jsonify({'session': session, 'message': 'Session created successfully'})
    except Exception as e:
        logger.error(f"Error creating session: {e}")
        return jsonify({'error': 'Failed to create session'}), 500

@app.route('/api/sessions/<int:session_id>', methods=['GET'])
def get_session_by_id(session_id):
    """Get a specific session."""
    try:
        session = get_session(session_id)
        if not session:
            return jsonify({'error': 'Session not found'}), 404
        
        return jsonify({'session': session})
    except Exception as e:
        logger.error(f"Error getting session: {e}")
        return jsonify({'error': 'Failed to get session'}), 500

@app.route('/api/sessions/<int:session_id>', methods=['DELETE'])
def delete_session_by_id(session_id):
    """Delete a session."""
    try:
        session = get_session(session_id)
        if not session:
            return jsonify({'error': 'Session not found'}), 404
        
        delete_session(session_id)
        return jsonify({'message': 'Session deleted successfully'})
    except Exception as e:
        logger.error(f"Error deleting session: {e}")
        return jsonify({'error': 'Failed to delete session'}), 500

@app.route('/api/sessions/<int:session_id>/save', methods=['POST'])
def save_session_data_endpoint(session_id):
    """Save session data."""
    try:
        session = get_session(session_id)
        if not session:
            return jsonify({'error': 'Session not found'}), 404
        
        data = request.get_json()
        spreadsheet_data = data.get('data', [])
        column_configs = data.get('columnConfigs', {})
        
        save_session_data(session_id, spreadsheet_data, column_configs)
        
        return jsonify({'message': 'Session data saved successfully'})
    except Exception as e:
        logger.error(f"Error saving session data: {e}")
        return jsonify({'error': 'Failed to save session data'}), 500

@app.route('/api/sessions/<int:session_id>/load', methods=['GET'])
def load_session_data_endpoint(session_id):
    """Load session data."""
    try:
        session = get_session(session_id)
        if not session:
            return jsonify({'error': 'Session not found'}), 404
        
        cell_data, column_configs = load_session_data(session_id)
        
        # Convert to frontend format
        data = []
        column_configs_dict = {}
        
        # Process cell data
        for cell_row in cell_data:
            while len(data) <= cell_row['row_index']:
                data.append([])
            
            while len(data[cell_row['row_index']]) <= cell_row['col_index']:
                data[cell_row['row_index']].append({
                    'id': f"cell-{cell_row['row_index']}-{cell_row['col_index']}",
                    'value': '',
                    'result': '',
                    'status': '',
                    'references': []
                })
            
            # Parse references JSON
            references = []
            if cell_row['cell_references']:
                try:
                    references = json.loads(cell_row['cell_references'])
                except:
                    references = []
            
            data[cell_row['row_index']][cell_row['col_index']] = {
                'id': f"cell-{cell_row['row_index']}-{cell_row['col_index']}",
                'value': cell_row['cell_value'] or '',
                'result': cell_row['cell_result'] or '',
                'status': cell_row['cell_status'] or '',
                'references': references
            }
        
        # Process column configurations
        for config_row in column_configs:
            column_configs_dict[config_row['col_index']] = {
                'name': config_row['column_name'] or '',
                'referenceCol': config_row['reference_col'],
                'prompt': config_row['prompt'] or ''
            }
        
        return jsonify({
            'data': data,
            'columnConfigs': column_configs_dict
        })
    except Exception as e:
        logger.error(f"Error loading session data: {e}")
        return jsonify({'error': 'Failed to load session data'}), 500

@app.route('/api/cluster', methods=['POST'])
def cluster_texts():
    """Cluster texts using sentence transformers."""
    try:
        data = request.get_json()
        if not data:
            return jsonify({'error': 'No data provided'}), 400
        
        # Validate request
        clustering_request = ClusteringRequest(**data)
        
        if not clustering_request.texts:
            return jsonify({'error': 'No texts provided for clustering'}), 400
        
        logger.info(f"Clustering {len(clustering_request.texts)} texts using {clustering_request.method}")
        
        # Perform enhanced clustering
        clusters, dimensions, pca_explained_variance = perform_clustering(
            texts=clustering_request.texts,
            method=clustering_request.method,
            n_clusters=clustering_request.n_clusters,
            eps=clustering_request.eps,
            min_samples=clustering_request.min_samples
        )
        
        # Prepare response
        parameters = {
            'method': clustering_request.method,
            'n_clusters': clustering_request.n_clusters if clustering_request.method == 'kmeans' else None,
            'eps': clustering_request.eps if clustering_request.method == 'dbscan' else None,
            'min_samples': clustering_request.min_samples if clustering_request.method == 'dbscan' else None
        }
        
        response = ClusteringResponse(
            clusters=clusters,
            dimensions=dimensions,
            method=clustering_request.method,
            parameters=parameters,
            total_items=len(clustering_request.texts),
            pca_explained_variance=pca_explained_variance
        )
        
        return jsonify(response.dict())
        
    except Exception as e:
        logger.error(f"Error in clustering: {e}")
        return jsonify({'error': str(e)}), 500

if __name__ == '__main__':
    logger.info("Starting Flask server...")
    app.run(debug=True, port=5001) 