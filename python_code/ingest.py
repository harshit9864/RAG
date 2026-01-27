import os
from engine import VeriDocEngine

if __name__ == "__main__":
    pdf_file = "2023ar_first_50_pages.pdf"
    
    if os.path.exists(pdf_file):
        engine = VeriDocEngine()
        
        # Uncomment this line ONLY when you want to ingest new data.
        # Since we now have persistence, you can comment it out after the first run!
        # engine.ingest_document(pdf_file)
        
        test_queries = [
             "List all 14 brand names mentioned under the IMC International Metalworking Companies subsidiary. Do not include general descriptive terms."
        ]
        
        for query in test_queries:
            engine.query(query, debug=True)
            print("\n" + "="*70 + "\n")
    else:
        print(f"Error: {pdf_file} not found!")