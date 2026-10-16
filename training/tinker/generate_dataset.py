"""Generate the synthetic A2C field-mapping dataset.

All examples are hand-written synthetic form LABELS (no values, no user data).
Train and eval use disjoint phrasings so evaluation measures generalisation to
unseen wording, e.g. "Educational Institution" is only in eval.

Usage: python training/tinker/generate_dataset.py
"""

from __future__ import annotations

import random

from common import DATA_DIR, KEYS, build_prompt, completion_for, write_jsonl

SEED = 2026

# key: (field type, train phrasings, eval phrasings)
PHRASES: dict[str, tuple[str, list[str], list[str]]] = {
    "full_name": ("text", ["Full name", "Your name", "Name", "Applicant name", "Legal name", "Participant name", "Student name", "Name (as on ID)"], ["Candidate name", "What is your name?", "Complete name", "Name of applicant"]),
    "preferred_name": ("text", ["Preferred name", "Nickname", "Display name"], ["What should we call you?", "Name you go by"]),
    "email": ("email", ["Email", "Email address", "E-mail", "Contact email", "Work email", "Mail ID"], ["Contact E-mail", "Where can we email you?", "Your e-mail id"]),
    "phone": ("tel", ["Phone", "Phone number", "Mobile number", "Contact number", "Cell phone"], ["WhatsApp number", "Mobile (with country code)", "Telephone"]),
    "city": ("text", ["City", "Current city", "Town"], ["City of residence", "Which city do you live in?"]),
    "country": ("text", ["Country", "Country of residence"], ["Nation", "Which country are you based in?"]),
    "college": ("text", ["College", "College name", "University", "Institute", "School", "Name of your university", "University currently attending"], ["Educational Institution", "Academic institution", "Which university do you attend?", "Alma mater"]),
    "degree": ("text", ["Degree", "Qualification", "Degree program", "Highest qualification"], ["Level of study", "Degree you are pursuing", "Programme of study"]),
    "major": ("text", ["Major", "Field of study", "Branch", "Specialization"], ["Discipline", "Area of study", "Stream"]),
    "graduation_year": ("text", ["Graduation year", "Year of graduation", "Expected graduation", "Passing year", "Batch"], ["Year of Passing", "Class of", "When do you graduate?", "Expected graduation year"]),
    "gpa": ("text", ["GPA", "CGPA", "Grade point average"], ["Cumulative GPA", "Current CGPA (out of 10)"]),
    "skills": ("text", ["Skills", "Technical skills", "Tech stack", "Programming languages", "Tools and frameworks"], ["Technical competencies", "Technologies you know", "Core expertise"]),
    "github_url": ("url", ["GitHub", "GitHub profile", "GitHub URL", "Code repository", "Repo link"], ["Developer Repository", "Professional code hosting profile", "Link to your source code profile"]),
    "linkedin_url": ("url", ["LinkedIn", "LinkedIn profile", "LinkedIn URL"], ["Professional network profile", "Linked In page"]),
    "portfolio_url": ("url", ["Portfolio", "Portfolio website", "Personal website", "Homepage"], ["Personal site", "Link to your work samples", "Blog or personal page"]),
    "current_role": ("text", ["Current role", "Job title", "Designation"], ["Current position", "Occupation"]),
    "years_experience": ("number", ["Years of experience", "Total experience (years)"], ["How many years have you worked?", "Experience in years"]),
    "work_experience": ("textarea", ["Work experience", "Employment history", "Internship experience"], ["Professional experience", "Previous experience"]),
    "bio": ("textarea", ["Bio", "Short bio", "About me"], ["Professional summary", "Summary"]),
    "date_of_birth": ("date", ["Date of birth", "DOB", "Birth date"], ["Birthday", "When were you born?"]),
}

ASK_USER = (
    ["T-shirt size", "Team name", "Dietary restrictions", "How did you hear about us?", "Preferred work mode", "Project title", "Track you are applying for"],
    ["Hackathon theme preference", "Company name", "Emergency contact relationship", "Accommodation needed?"],
)
SKIP = (
    ["Password", "Confirm password", "OTP", "One-time password", "CVV", "Card number", "API key", "Recovery code", "Bank account number", "Secret key"],
    ["Enter the 6-digit code we sent", "Credit card", "Security code (CVC)", "Access token", "Private key", "Seed phrase"],
)

DECORATIONS = ["{}", "{} *", "{} (required)", "Your {}", "{}:"]


def decorate(label: str, rng: random.Random) -> str:
    fmt = rng.choice(DECORATIONS)
    text = fmt.format(label if not fmt.startswith("Your ") else label[0].lower() + label[1:])
    return text if rng.random() > 0.2 else text.upper()


def make_rows(split: int, rng: random.Random, variants: int) -> list[dict]:
    rows: list[dict] = []

    def add(label: str, field_type: str, target: str) -> None:
        rows.append({"label": label, "type": field_type, "options": [], "target": target, "prompt": build_prompt(label, field_type), "completion": completion_for(target)})

    for key, (ftype, train, evals) in PHRASES.items():
        assert key in KEYS, key
        for phrase in (train if split == 0 else evals):
            add(phrase, ftype, key)
            for _ in range(variants):
                add(decorate(phrase, rng), ftype, key)
    for phrase in ASK_USER[split]:
        add(phrase, "text", "ask_user")
    for phrase in SKIP[split]:
        add(phrase, "password" if "password" in phrase.lower() else "text", "skip")
    return rows


def main() -> None:
    rng = random.Random(SEED)
    train = make_rows(0, rng, variants=2)
    evaluation = make_rows(1, rng, variants=0)
    rng.shuffle(train)
    write_jsonl(DATA_DIR / "train.jsonl", train)
    write_jsonl(DATA_DIR / "eval.jsonl", evaluation)
    overlap = {r["label"].lower() for r in train} & {r["label"].lower() for r in evaluation}
    print(f"train={len(train)} eval={len(evaluation)} overlapping labels={len(overlap)}")


if __name__ == "__main__":
    main()
