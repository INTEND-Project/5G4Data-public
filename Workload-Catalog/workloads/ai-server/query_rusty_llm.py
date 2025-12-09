#!/usr/bin/env python3
"""
Script to send queries to rusty-llm every 10 seconds with different question types.
This generates load for monitoring inference response time metrics.

Usage:
    # REQUIRED: Set up port-forward first (in a separate terminal):
    kubectl port-forward -n rusty-llm svc/rusty-llm 8080:8080
    
    # Then run this script:
    python3 query_rusty_llm.py
    # or
    ./run_query_script.sh
    
    Note: With Minikube, NodePort services are not directly accessible from the host.
    Port-forward is the recommended way to access the service.
"""

import requests
import time
import random
import sys
import json
from datetime import datetime
from typing import List, Dict

# Configuration
RUSTY_LLM_URL = "http://129.242.22.51:30872/rusty-llm-ext"
QUERY_INTERVAL = 10  # seconds
LOG_REQUESTS = True

# Different types of questions to test various scenarios
QUESTION_TYPES = {
    "factual": [
        "What is the capital of France?",
        "Who wrote Romeo and Juliet?",
        "What is the speed of light?",
        "When was the first computer invented?",
        "What is the largest planet in our solar system?",
    ],
    "technical": [
        "Explain how Kubernetes works.",
        "What is the difference between REST and GraphQL?",
        "How does a neural network learn?",
        "Explain the concept of microservices architecture.",
        "What is container orchestration?",
    ],
    "creative": [
        "Write a short poem about technology.",
        "Tell me a creative story about a robot.",
        "Describe a futuristic city in 100 words.",
        "What would happen if AI could dream?",
    ],
    "analytical": [
        "Compare and contrast machine learning and deep learning.",
        "What are the advantages and disadvantages of cloud computing?",
        "Analyze the impact of artificial intelligence on society.",
        "Explain the trade-offs between monolithic and microservices architectures.",
    ],
    "short": [
        "Hello",
        "Hi there",
        "What's up?",
        "Tell me a joke",
        "How are you?",
    ],
    "long": [
        "Can you provide a detailed explanation of how distributed systems handle consistency and what are the different consistency models used in practice?",
        "Explain the complete lifecycle of a Kubernetes pod from creation to termination, including all the stages and events that occur.",
        "Describe in detail how transformer models work in natural language processing, including attention mechanisms and their applications.",
    ],
}

def send_query(url: str, question: str, question_type: str) -> Dict:
    """
    Send a query to the rusty-llm API.
    
    Args:
        url: Base URL of the rusty-llm service
        question: The question to ask
        question_type: Type of question (for logging)
    
    Returns:
        Dictionary with response information
    """
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    
    try:
        # Rusty-llm uses OpenAI-compatible API format
        endpoint = "/v1/chat/completions"
        full_url = f"{url}{endpoint}"
        
        # Format request according to rusty-llm API
        # Note: rusty-llm requires stream=true and model="rusty_llm"
        payload = {
            "model": "rusty_llm",
            "messages": [
                {
                    "role": "user",
                    "content": question
                }
            ],
            "stream": True  # rusty-llm requires streaming mode
        }
        
        # Measure time from start of request
        start_time = time.time()
        
        response = requests.post(
            full_url,
            json=payload,
            timeout=30,
            headers={"Content-Type": "application/json"},
            stream=True  # Enable streaming response
        )
        
        used_endpoint = endpoint
        
        # For streaming responses, we need to read the stream to completion
        # to get the full response time and extract the actual content
        content_length = 0
        full_response_text = ""
        if response.status_code == 200:
            try:
                for line in response.iter_lines():
                    if line:
                        content_length += len(line)
                        # Parse streaming response (Server-Sent Events format)
                        line_str = line.decode('utf-8')
                        if line_str.startswith('data: '):
                            data_str = line_str[6:]  # Remove 'data: ' prefix
                            if data_str.strip() == '[DONE]':
                                break
                            try:
                                data = json.loads(data_str)
                                # Extract content from OpenAI-compatible streaming format
                                if 'choices' in data and len(data['choices']) > 0:
                                    delta = data['choices'][0].get('delta', {})
                                    if 'content' in delta:
                                        full_response_text += delta['content']
                            except json.JSONDecodeError:
                                # Skip invalid JSON lines
                                pass
            except Exception as e:
                # If stream reading fails, still record the attempt
                pass
        
        # Calculate total response time
        response_time = time.time() - start_time
        
        if response and response.status_code == 200:
            result = {
                "success": True,
                "timestamp": timestamp,
                "question_type": question_type,
                "question": question,
                "response_time": response_time,
                "status_code": response.status_code,
                "endpoint": used_endpoint,
                "response_length": content_length,
                "response_text": full_response_text.strip(),
            }
            
            if LOG_REQUESTS:
                # Truncate response for display if too long
                response_preview = full_response_text.strip()[:200] if full_response_text.strip() else "(empty)"
                if len(full_response_text.strip()) > 200:
                    response_preview += "..."
                print(f"[{timestamp}] ✓ {question_type:12} | {response_time:.3f}s | {question[:50]}...")
                print(f"  → Answer: {response_preview}")
            
            return result
        else:
            error_msg = response.text if response else "No response"
            result = {
                "success": False,
                "timestamp": timestamp,
                "question_type": question_type,
                "question": question,
                "error": f"HTTP {response.status_code if response else 'N/A'}: {error_msg[:100]}",
                "endpoint": used_endpoint,
            }
            
            print(f"[{timestamp}] ✗ {question_type:12} | ERROR: {result['error']}")
            return result
            
    except requests.exceptions.Timeout:
        result = {
            "success": False,
            "timestamp": timestamp,
            "question_type": question_type,
            "question": question,
            "error": "Request timeout",
        }
        print(f"[{timestamp}] ✗ {question_type:12} | TIMEOUT")
        return result
        
    except Exception as e:
        result = {
            "success": False,
            "timestamp": timestamp,
            "question_type": question_type,
            "question": question,
            "error": str(e),
        }
        print(f"[{timestamp}] ✗ {question_type:12} | ERROR: {e}")
        return result


def get_random_question() -> tuple:
    """Get a random question from all question types."""
    all_questions = []
    for q_type, questions in QUESTION_TYPES.items():
        for q in questions:
            all_questions.append((q_type, q))
    
    return random.choice(all_questions)


def get_question_by_type(q_type: str) -> str:
    """Get a random question of a specific type."""
    if q_type in QUESTION_TYPES:
        return random.choice(QUESTION_TYPES[q_type])
    return random.choice(QUESTION_TYPES["factual"])


def main():
    """Main loop to send queries every 10 seconds."""
    print("=" * 80)
    print("Rusty-LLM Query Load Generator")
    print("=" * 80)
    print(f"Target URL: {RUSTY_LLM_URL}")
    print(f"Query Interval: {QUERY_INTERVAL} seconds")
    print(f"Press Ctrl+C to stop")
    print("=" * 80)
    print()
    
    stats = {
        "total": 0,
        "success": 0,
        "failed": 0,
        "total_response_time": 0.0,
        "by_type": {},
    }
    
    try:
        while True:
            # Get a random question
            question_type, question = get_random_question()
            
            # Send the query
            result = send_query(RUSTY_LLM_URL, question, question_type)
            
            # Update statistics
            stats["total"] += 1
            if result["success"]:
                stats["success"] += 1
                stats["total_response_time"] += result.get("response_time", 0)
                
                # Track by type
                if question_type not in stats["by_type"]:
                    stats["by_type"][question_type] = {"count": 0, "total_time": 0.0}
                stats["by_type"][question_type]["count"] += 1
                stats["by_type"][question_type]["total_time"] += result.get("response_time", 0)
            else:
                stats["failed"] += 1
            
            # Print statistics every 10 queries
            if stats["total"] % 10 == 0:
                avg_time = stats["total_response_time"] / stats["success"] if stats["success"] > 0 else 0
                print(f"\n📊 Stats: {stats['success']}/{stats['total']} successful | "
                      f"Avg response time: {avg_time:.3f}s | "
                      f"Success rate: {100*stats['success']/stats['total']:.1f}%")
                print()
            
            # Wait before next query
            time.sleep(QUERY_INTERVAL)
            
    except KeyboardInterrupt:
        print("\n" + "=" * 80)
        print("Stopping query generator...")
        print("=" * 80)
        
        # Print final statistics
        print(f"\nFinal Statistics:")
        print(f"  Total queries: {stats['total']}")
        print(f"  Successful: {stats['success']}")
        print(f"  Failed: {stats['failed']}")
        
        if stats["success"] > 0:
            avg_time = stats["total_response_time"] / stats["success"]
            print(f"  Average response time: {avg_time:.3f}s")
            print(f"\n  By question type:")
            for q_type, type_stats in stats["by_type"].items():
                type_avg = type_stats["total_time"] / type_stats["count"]
                print(f"    {q_type:12}: {type_stats['count']:3} queries, avg {type_avg:.3f}s")
        
        print()
        sys.exit(0)


if __name__ == "__main__":
    main()

