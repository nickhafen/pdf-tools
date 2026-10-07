import os
import pymupdf

SAMPLES_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static", "samples")

def create_sample_pdfs():
    os.makedirs(SAMPLES_DIR, exist_ok=True)
    # Document 1: Original Agreement
    doc1 = pymupdf.open()
    page1 = doc1.new_page(width=612, height=792)
    
    text_v1 = """MASTER SERVICES AGREEMENT
Version 1.0 - Confidential

1. PARTIES & EFFECTIVE DATE
This Master Services Agreement ("Agreement") is entered into as of January 15, 2026, by and between Alpha Solutions Inc. ("Provider") and Beta Enterprises LLC ("Client").

2. SCOPE OF SERVICES
Provider agrees to render cloud infrastructure engineering, continuous integration pipeline setup, and security auditing services to Client as described in Statement of Work #1.

3. FEES & PAYMENT TERMS
3.1 Client agrees to pay Provider a fixed fee of $45,000 for the initial infrastructure overhaul.
3.2 Invoices shall be submitted monthly and are payable Net 30 days from the invoice date.
3.3 Late payments shall incur interest at the rate of 1.5% per month or the maximum rate permitted by law.

4. CONFIDENTIALITY
Each party agrees to maintain strict confidentiality regarding all proprietary information, software code, customer data, and trade secrets disclosed during the performance of this Agreement.

5. TERMINATION
Either party may terminate this Agreement without cause by providing 30 days prior written notice to the other party.

6. GOVERNING LAW
This Agreement shall be governed by and construed in accordance with the laws of the State of California.
"""
    
    # Write text to page 1
    rect1 = pymupdf.Rect(54, 54, 558, 738)
    page1.insert_textbox(rect1, text_v1, fontsize=11, fontname="helv")
    doc1.save(os.path.join(SAMPLES_DIR, "sample_contract_v1.pdf"))
    doc1.close()

    # Document 2: Modified Agreement (with additions, deletions, and alterations)
    doc2 = pymupdf.open()
    page2 = doc2.new_page(width=612, height=792)
    
    text_v2 = """MASTER SERVICES AGREEMENT
Version 2.1 - Revised & Updated

1. PARTIES & EFFECTIVE DATE
This Master Services Agreement ("Agreement") is entered into as of February 1, 2026, by and between Alpha Solutions Inc. ("Provider") and Gamma Global Corp ("Client").

2. SCOPE OF SERVICES
Provider agrees to render cloud infrastructure engineering, AI model fine-tuning, continuous deployment pipeline setup, and zero-trust security auditing services to Client as described in Statement of Work #2.

3. FEES & PAYMENT TERMS
3.1 Client agrees to pay Provider a fixed fee of $62,000 for the initial infrastructure and AI integration overhaul.
3.2 Invoices shall be submitted bi-weekly and are payable Net 15 days from the invoice date.
3.3 Late payments shall incur interest at the rate of 2.5% per month or the maximum rate permitted by law.
3.4 Provider reserves the right to suspend services if invoices remain unpaid past 45 days.

4. CONFIDENTIALITY & DATA PRIVACY
Each party agrees to maintain strict confidentiality regarding all proprietary information, software source code, AI training data, customer data, and trade secrets disclosed during the performance of this Agreement.

5. TERMINATION FOR CAUSE
Either party may terminate this Agreement immediately upon written notice if the other party breaches any material obligation and fails to cure such breach within 14 business days.

6. LIMITATION OF LIABILITY
In no event shall either party be liable for any indirect, incidental, or consequential damages arising out of this Agreement.

7. GOVERNING LAW
This Agreement shall be governed by and construed in accordance with the laws of the State of Delaware.
"""

    rect2 = pymupdf.Rect(54, 54, 558, 738)
    page2.insert_textbox(rect2, text_v2, fontsize=11, fontname="helv")
    doc2.save(os.path.join(SAMPLES_DIR, "sample_contract_v2.pdf"))
    doc2.close()
    print(f"Sample PDFs created in {SAMPLES_DIR}")

if __name__ == "__main__":
    create_sample_pdfs()
