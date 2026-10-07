"""Generate the bundled demo PDF pairs in static/samples/ plus manifest.json.

Every document here is synthetic: the parties, people, cases and citations are
fictitious. Each pair is built to exercise a different part of the redline
(headings and renumbering, nested lists, multi-page prose, moved text).
"""
import functools
import html
import io
import json
import os
import pymupdf

SAMPLES_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static", "samples")

DISCLAIMER = "Sample document. All names and facts are fictitious."


# ==============================================================================
# RENDERING
# ==============================================================================

def _write_textbox_pdf(path, text):
    """Single page of plain text (the original MSA sample's style)."""
    doc = pymupdf.open()
    page = doc.new_page(width=612, height=792)
    page.insert_textbox(pymupdf.Rect(54, 54, 558, 738), text, fontsize=11, fontname="helv")
    doc.save(path)
    doc.close()


def _blocks_to_html(blocks):
    """Blocks are (kind, content) tuples: h1/h2/h3/p/small take a string, ul/ol
    take a list whose items are strings or (string, [sub-items])."""
    def items_html(tag, items):
        out = []
        for item in items:
            if isinstance(item, tuple):
                text, sub = item
                out.append(f"<li>{html.escape(text)}{items_html(tag, sub)}</li>")
            else:
                out.append(f"<li>{html.escape(item)}</li>")
        return f"<{tag}>{''.join(out)}</{tag}>"

    parts = []
    for kind, content in blocks:
        if kind in ("ul", "ol"):
            parts.append(items_html(kind, content))
        elif kind == "small":
            parts.append(f'<p class="small">{html.escape(content)}</p>')
        else:
            parts.append(f"<{kind}>{html.escape(content)}</{kind}>")
    return "\n".join(parts)


def _write_story_pdf(path, blocks, font="sans-serif"):
    """Flow formatted blocks across as many Letter pages as they need."""
    css = f"""
        body {{ font-family: {font}; font-size: 11pt; line-height: 1.35; }}
        h1 {{ font-size: 16pt; text-align: center; margin: 0 0 4pt 0; }}
        h2 {{ font-size: 12.5pt; margin: 12pt 0 4pt 0; }}
        h3 {{ font-size: 11pt; margin: 8pt 0 2pt 0; }}
        p {{ margin: 0 0 7pt 0; text-align: justify; }}
        p.small {{ font-size: 8.5pt; text-align: center; color: #555555; margin-bottom: 12pt; }}
        ul, ol {{ margin: 0 0 7pt 0; }}
        li {{ margin-bottom: 2pt; }}
    """
    story = pymupdf.Story(html=_blocks_to_html(blocks), user_css=css)
    mediabox = pymupdf.paper_rect("letter")
    where = mediabox + (72, 72, -72, -72)
    buffer = io.BytesIO()
    writer = pymupdf.DocumentWriter(buffer)
    more = 1
    while more:
        device = writer.begin_page(mediabox)
        more, _ = story.place(where)
        story.draw(device)
        writer.end_page()
    writer.close()

    # Story embeds whole fonts (~100-500 KB each); keep only the glyphs used.
    doc = pymupdf.open("pdf", buffer.getvalue())
    doc.subset_fonts()
    doc.save(path, garbage=4, deflate=True)
    doc.close()


# ==============================================================================
# SAMPLE 1: MASTER SERVICES AGREEMENT (single page; the default "Load Sample")
# ==============================================================================

MSA_V1 = """MASTER SERVICES AGREEMENT
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

MSA_V2 = """MASTER SERVICES AGREEMENT
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


# ==============================================================================
# SAMPLE 2: MUTUAL NDA (defined-term rename, inserted section + renumbering,
# list items added/removed)
# ==============================================================================

NDA_V1 = [
    ("h1", "Mutual Nondisclosure Agreement"),
    ("small", DISCLAIMER),
    ("p", 'This Mutual Nondisclosure Agreement (the "Agreement") is made as of March 3, 2026 (the "Effective Date") between Halvorsen Robotics, Inc., a Delaware corporation ("Halvorsen"), and Quillfeather Analytics LLC, a Utah limited liability company ("Quillfeather"). Each party may disclose Confidential Information to the other in connection with evaluating a possible joint development of warehouse automation software (the "Purpose").'),
    ("h2", "1. Definition of Confidential Information"),
    ("p", '"Confidential Information" means any non-public information disclosed by one party (the "Discloser") to the other party (the "Recipient"), whether orally, in writing, or by inspection, that is marked as confidential or that a reasonable person would understand to be confidential. Confidential Information includes source code, product roadmaps, pricing, customer lists, and financial information.'),
    ("h2", "2. Exclusions"),
    ("p", "Confidential Information does not include information that the Recipient can show:"),
    ("ul", [
        "is or becomes publicly available through no fault of the Recipient;",
        "was known to the Recipient before disclosure by the Discloser;",
        "is received from a third party without a duty of confidentiality; or",
        "is independently developed by the Recipient.",
    ]),
    ("h2", "3. Obligations of the Recipient"),
    ("p", "The Recipient will use Confidential Information only for the Purpose and will protect it using at least the same degree of care it uses for its own confidential information, but no less than reasonable care. The Recipient may share Confidential Information only with its employees who need to know it for the Purpose."),
    ("h2", "4. Compelled Disclosure"),
    ("p", "If the Recipient is required by law to disclose Confidential Information, it will give the Discloser prompt notice so the Discloser may seek a protective order, and will disclose only the portion legally required."),
    ("h2", "5. Term"),
    ("p", "This Agreement remains in effect for two (2) years from the Effective Date. The Recipient's obligations survive for two (2) years after the Agreement ends."),
    ("h2", "6. No License"),
    ("p", "Nothing in this Agreement grants the Recipient any license or other right in the Discloser's Confidential Information, except the limited right to use it for the Purpose."),
    ("h2", "7. Governing Law"),
    ("p", "This Agreement is governed by the laws of the State of Delaware, without regard to its conflict of laws rules."),
    ("h2", "8. Entire Agreement"),
    ("p", "This Agreement is the entire agreement between the parties about its subject matter and may be amended only in a writing signed by both parties."),
]

NDA_V2 = [
    ("h1", "Mutual Nondisclosure Agreement"),
    ("small", DISCLAIMER),
    ("p", 'This Mutual Nondisclosure Agreement (the "Agreement") is made as of March 17, 2026 (the "Effective Date") between Halvorsen Robotics, Inc., a Delaware corporation ("Halvorsen"), and Quillfeather Analytics LLC, a Utah limited liability company ("Quillfeather"). Each party may disclose Confidential Information to the other in connection with evaluating a possible joint development and licensing of warehouse automation software (the "Purpose").'),
    ("h2", "1. Definition of Confidential Information"),
    ("p", '"Confidential Information" means any non-public information disclosed by one party (the "Disclosing Party") to the other party (the "Receiving Party"), whether orally, in writing, or by inspection, that is marked as confidential or that a reasonable person would understand to be confidential. Confidential Information includes source code, machine learning models and training data, product roadmaps, pricing, customer lists, and financial information.'),
    ("h2", "2. Exclusions"),
    ("p", "Confidential Information does not include information that the Receiving Party can show by written records:"),
    ("ul", [
        "is or becomes publicly available through no fault of the Receiving Party;",
        "was lawfully known to the Receiving Party before disclosure by the Disclosing Party;",
        "is received from a third party without a duty of confidentiality; or",
        "is independently developed by the Receiving Party without use of the Disclosing Party's Confidential Information.",
    ]),
    ("h2", "3. Obligations of the Receiving Party"),
    ("p", "The Receiving Party will use Confidential Information only for the Purpose and will protect it using at least the same degree of care it uses for its own confidential information, but no less than reasonable care. The Receiving Party may share Confidential Information only with its employees, contractors, and professional advisors who need to know it for the Purpose and who are bound by written confidentiality obligations at least as protective as this Agreement."),
    ("h2", "4. Compelled Disclosure"),
    ("p", "If the Receiving Party is required by law to disclose Confidential Information, it will, to the extent legally permitted, give the Disclosing Party prompt written notice so the Disclosing Party may seek a protective order, and will disclose only the portion legally required."),
    ("h2", "5. Return or Destruction of Materials"),
    ("p", "Within fifteen (15) days after the Disclosing Party's written request, the Receiving Party will return or destroy all Confidential Information in its possession and certify the destruction in writing. The Receiving Party may keep archival copies required by law, which remain subject to this Agreement."),
    ("h2", "6. Term"),
    ("p", "This Agreement remains in effect for three (3) years from the Effective Date. The Receiving Party's obligations survive for three (3) years after the Agreement ends, except that obligations for trade secrets survive for as long as the information remains a trade secret."),
    ("h2", "7. No License"),
    ("p", "Nothing in this Agreement grants the Receiving Party any license or other right in the Disclosing Party's Confidential Information, except the limited right to use it for the Purpose."),
    ("h2", "8. Remedies"),
    ("p", "Unauthorized use or disclosure of Confidential Information may cause irreparable harm for which damages are an inadequate remedy. The Disclosing Party may seek injunctive relief in addition to any other remedy available at law or in equity."),
    ("h2", "9. Governing Law"),
    ("p", "This Agreement is governed by the laws of the State of Utah, without regard to its conflict of laws rules. The state and federal courts located in Salt Lake County, Utah have exclusive jurisdiction over any dispute arising under this Agreement."),
    ("h2", "10. Entire Agreement"),
    ("p", "This Agreement is the entire agreement between the parties about its subject matter and may be amended only in a writing signed by both parties."),
]


# ==============================================================================
# SAMPLE 3: LEGAL MEMORANDUM (multi-page serif prose; rewritten conclusion,
# moved paragraph, added section, small citation and typo fixes)
# ==============================================================================

_MEMO_HEADER = [
    ("h1", "Memorandum"),
    ("small", DISCLAIMER),
    ("p", "TO: Margaret Okafor, Partner"),
    ("p", "FROM: Daniel Reyes, Associate"),
]

_MEMO_FACTS = [
    ("h2", "Statement of Facts"),
    ("p", "Pinecrest Outfitters, Inc. operates eleven outdoor-equipment stores. In 2022 it hired Jordan Vail as a regional sales manager. As a condition of employment, Vail signed an agreement providing that for eighteen months after leaving Pinecrest, Vail would not work for any competing retailer within 100 miles of any Pinecrest store. Vail received no compensation for signing beyond the job itself."),
    ("p", "In August 2026 Vail resigned and accepted a store-manager position with Ridgeline Supply Co., a competing retailer whose nearest store is 40 miles from a Pinecrest location. Vail took no documents when leaving, but knows Pinecrest's seasonal pricing strategy and its vendor terms."),
]

MEMO_V1 = _MEMO_HEADER + [
    ("p", "DATE: September 22, 2026"),
    ("p", "RE: Enforceability of the Vail non-compete agreement"),
    ("h2", "Question Presented"),
    ("p", "Can Pinecrest Outfitters enforce the non-competition covenant in Jordan Vail's employment agreement to prevent Vail from working for Ridgeline Supply Co.?"),
    ("h2", "Brief Answer"),
    ("p", "Probably yes. The covenant protects Pinecrest's legitimate interest in its confidential pricing information, and a court is likely to find its duration and geographic scope reasonable."),
] + _MEMO_FACTS + [
    ("h2", "Discussion"),
    ("p", "Courts in this state enforce a covenant not to compete only if it is supported by consideration, negotiated in good faith, necessary to protect a legitimate business interest, and reasonable in its restrictions on time and area. Harlow v. Dunmore Supply Co., No. 24-0117, slip op. at 6 (Ct. App. 2025). The employer bears the burden on each element."),
    ("h3", "A. Legitimate Business Interest"),
    ("p", "An employer may not restrain ordinary competition; it may protect only goodwill, trade secrets, or confidential information that the employee could use unfairly. Harlow, slip op. at 8. Pinecrest's seasonal pricing strategy and vendor terms are not publicly available and would give Ridgeline an advantage it did not earn. This element likely favors Pinecrest."),
    ("p", "Vail will argue that pricing information becomes stale quickly in retail. That argument has some force for the 2026 season but less for vendor terms, which Pinecrest negotiates on multi-year cycles."),
    ("h3", "B. Reasonableness of Time and Area"),
    ("p", "Restrictions of one to two years are routinely upheld. See Corbin Medical Group v. Asante, No. 21-0442, slip op. at 11 (Ct. App. 2022). A 100-mile radius around each of eleven stores, however, covers most of the state's populated areas. A court may narrow an overbroad restriction rather than void it, but is not required to do so. Harlow, slip op. at 12."),
    ("h3", "C. Consideration"),
    ("p", "Initial employment is sufficent consideration for a covenant signed at the start of employment. Vail signed when hired, so this element is satisfied."),
    ("h2", "Conclusion"),
    ("p", "Pinecrest has a reasonable chance of enforcing the covenant, at least in narrowed form. We should send Ridgeline a letter notifying it of the agreement before considering litigation."),
]

MEMO_V2 = _MEMO_HEADER + [
    ("p", "DATE: September 29, 2026"),
    ("p", "RE: Enforceability of the Vail non-compete agreement (revised)"),
    ("h2", "Question Presented"),
    ("p", "Can Pinecrest Outfitters enforce the non-competition covenant in Jordan Vail's employment agreement to prevent Vail from working for Ridgeline Supply Co. as a store manager?"),
    ("h2", "Brief Answer"),
    ("p", "Possibly, but only in narrowed form. The covenant protects Pinecrest's legitimate interest in its confidential vendor terms, and its eighteen-month duration is reasonable. Its 100-mile radius is likely overbroad, and a court may decline to enforce it at all rather than rewrite it."),
] + _MEMO_FACTS + [
    ("h2", "Discussion"),
    ("p", "Courts in this state enforce a covenant not to compete only if it is supported by consideration, negotiated in good faith, necessary to protect a legitimate business interest, and reasonable in its restrictions on time and area. Harlow v. Dunmore Supply Co., No. 24-0117, slip op. at 5-6 (Ct. App. 2025). The employer bears the burden on each element."),
    ("h3", "A. Consideration"),
    ("p", "Initial employment is sufficient consideration for a covenant signed at the start of employment. Vail signed when hired, so this element is satisfied."),
    ("h3", "B. Legitimate Business Interest"),
    ("p", "An employer may not restrain ordinary competition; it may protect only goodwill, trade secrets, or confidential information that the employee could use unfairly. Harlow, slip op. at 8. Pinecrest's vendor terms are not publicly available and would give Ridgeline an advantage it did not earn. This element likely favors Pinecrest."),
    ("p", "Vail will argue that pricing information becomes stale quickly in retail. That argument is persuasive for the seasonal pricing strategy, which Pinecrest resets each spring, so we should not rely on it. It is much weaker for vendor terms, which Pinecrest negotiates on multi-year cycles."),
    ("h3", "C. Reasonableness of Time and Area"),
    ("p", "Restrictions of one to two years are routinely upheld. See Corbin Medical Group v. Asante, No. 21-0442, slip op. at 11 (Ct. App. 2022). A 100-mile radius around each of eleven stores, however, covers most of the state's populated areas and reaches markets where Vail never worked. A court may narrow an overbroad restriction rather than void it, but is not required to do so, and it is less likely to help an employer that drafted the restriction aggressively. Harlow, slip op. at 12-13."),
    ("h3", "D. Good Faith"),
    ("p", "Pinecrest used the same form agreement for every manager regardless of territory, and Vail had no opportunity to negotiate it. A court could treat the uniform 100-mile radius as evidence that the restriction was not tailored to any real interest. We should collect any evidence that the radius was chosen for a business reason."),
    ("h2", "Conclusion"),
    ("p", "Pinecrest's position is weaker than it first appeared. Rather than threaten litigation, we recommend sending Ridgeline a letter that identifies the agreement and offers to limit enforcement to the two stores in Vail's former region for twelve months. That offer strengthens our position if a court is later asked to narrow the covenant."),
]


# ==============================================================================
# SAMPLE 4: RESIDENTIAL LEASE (nested numbered and bulleted lists, deleted and
# inserted list items, changed amounts)
# ==============================================================================

LEASE_V1 = [
    ("h1", "Residential Lease Agreement"),
    ("small", DISCLAIMER),
    ("p", 'This Lease is between Sagebrush Property Management LLC ("Landlord") and Priya Natarajan and Tomas Lindqvist (together, "Tenant") for the residence at 418 Juniper Hollow Lane, Unit 2B (the "Premises").'),
    ("h2", "1. Term"),
    ("p", "The Lease begins on June 1, 2026 and ends on May 31, 2027. After that it continues month to month until either party gives 30 days' written notice."),
    ("h2", "2. Rent and Deposit"),
    ("ol", [
        "Monthly rent is $1,650, due on the first day of each month.",
        "Rent paid after the fifth day of the month incurs a late fee of $75.",
        "Tenant will pay a security deposit of $1,650 before move-in.",
        "Landlord will return the deposit, less itemized deductions, within 30 days after Tenant moves out.",
    ]),
    ("h2", "3. Utilities"),
    ("p", "Responsibility for utilities is divided as follows:"),
    ("ul", [
        ("Landlord pays:", ["water and sewer", "trash collection"]),
        ("Tenant pays:", ["electricity", "natural gas", "internet and cable"]),
    ]),
    ("h2", "4. Pets"),
    ("p", "Tenant may keep one cat or one dog under 30 pounds, subject to the following:"),
    ("ul", [
        "a one-time pet fee of $300;",
        "proof of current vaccinations; and",
        "Tenant is responsible for any damage the pet causes.",
    ]),
    ("h2", "5. Maintenance and Repairs"),
    ("p", "Tenant will keep the Premises clean and promptly report any needed repairs. Landlord will make repairs needed to keep the Premises habitable within a reasonable time after notice."),
    ("h2", "6. Entry by Landlord"),
    ("p", "Landlord may enter the Premises at reasonable times to inspect or make repairs after giving at least 12 hours' notice, except in an emergency."),
    ("h2", "7. Parking"),
    ("p", "Tenant is assigned one covered parking space. Guest parking is first come, first served."),
    ("h2", "8. Signatures"),
    ("p", "Landlord: ______________________    Tenant: ______________________    Tenant: ______________________"),
]

LEASE_V2 = [
    ("h1", "Residential Lease Agreement"),
    ("small", DISCLAIMER),
    ("p", 'This Lease is between Sagebrush Property Management LLC ("Landlord") and Priya Natarajan and Tomas Lindqvist (together, "Tenant") for the residence at 418 Juniper Hollow Lane, Unit 2B (the "Premises").'),
    ("h2", "1. Term"),
    ("p", "The Lease begins on June 15, 2026 and ends on June 30, 2027. After that it continues month to month until either party gives 60 days' written notice."),
    ("h2", "2. Rent and Deposit"),
    ("ol", [
        "Monthly rent is $1,725, due on the first day of each month.",
        "Rent paid after the fifth day of the month incurs a late fee of $50.",
        "Rent for June 2026 is prorated to $920 and is due at move-in.",
        "Tenant will pay a security deposit of $1,725 before move-in.",
        "Landlord will return the deposit, less itemized deductions, within 30 days after Tenant moves out.",
    ]),
    ("h2", "3. Utilities"),
    ("p", "Responsibility for utilities is divided as follows:"),
    ("ul", [
        ("Landlord pays:", ["water and sewer", "trash and recycling collection", "internet"]),
        ("Tenant pays:", ["electricity", "natural gas"]),
    ]),
    ("h2", "4. Pets"),
    ("p", "Tenant may keep up to two cats, or one dog under 40 pounds, subject to the following:"),
    ("ul", [
        "a refundable pet deposit of $400;",
        "proof of current vaccinations;",
        "monthly pet rent of $25 per animal; and",
        "Tenant is responsible for any damage the pet causes.",
    ]),
    ("h2", "5. Maintenance and Repairs"),
    ("p", "Tenant will keep the Premises clean and promptly report any needed repairs through Landlord's online portal. Landlord will make repairs needed to keep the Premises habitable within a reasonable time after notice, and will respond to loss of heat or water within 24 hours."),
    ("h2", "6. Entry by Landlord"),
    ("p", "Landlord may enter the Premises at reasonable times to inspect or make repairs after giving at least 24 hours' notice, except in an emergency."),
    ("h2", "7. Smoking"),
    ("p", "Smoking and vaping of any substance are prohibited inside the Premises and on any balcony or patio."),
    ("h2", "8. Signatures"),
    ("p", "Landlord: ______________________    Tenant: ______________________    Tenant: ______________________"),
]


# ==============================================================================
# CATALOG
# ==============================================================================

# Listed in the app's "Load Sample" dropdown in this order; the first one is
# what the main "Load Sample" button loads.
SAMPLES = [
    {
        "id": "sample_contract",
        "title": "Master Services Agreement",
        "description": "One-page contract: new parties, fees, and an added section",
        "render": _write_textbox_pdf, "v1": MSA_V1, "v2": MSA_V2,
    },
    {
        "id": "nda",
        "title": "Mutual NDA",
        "description": "Renamed defined terms, inserted sections, renumbering",
        "render": _write_story_pdf, "v1": NDA_V1, "v2": NDA_V2,
    },
    {
        "id": "legal_memo",
        "title": "Legal Memorandum",
        "description": "Multi-page prose: rewritten analysis, moved section",
        "render": functools.partial(_write_story_pdf, font="serif"),
        "v1": MEMO_V1, "v2": MEMO_V2,
    },
    {
        "id": "lease",
        "title": "Residential Lease",
        "description": "Nested lists, changed amounts, a replaced section",
        "render": _write_story_pdf, "v1": LEASE_V1, "v2": LEASE_V2,
    },
]


def sample_filename(sample_id, version):
    return f"{sample_id}_{version}.pdf"


def create_sample_pdfs():
    os.makedirs(SAMPLES_DIR, exist_ok=True)
    manifest = []
    for sample in SAMPLES:
        for version in ("v1", "v2"):
            path = os.path.join(SAMPLES_DIR, sample_filename(sample["id"], version))
            sample["render"](path, sample[version])
        manifest.append({
            "id": sample["id"],
            "title": sample["title"],
            "description": sample["description"],
            "v1": sample_filename(sample["id"], "v1"),
            "v2": sample_filename(sample["id"], "v2"),
        })
    with open(os.path.join(SAMPLES_DIR, "manifest.json"), "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2)
        f.write("\n")
    print(f"{len(SAMPLES)} sample pairs created in {SAMPLES_DIR}")


if __name__ == "__main__":
    create_sample_pdfs()
