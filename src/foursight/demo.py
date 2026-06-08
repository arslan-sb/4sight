from .api import build_app
from .seed import load_company

app = build_app(seed_fn=load_company)
