from .api import build_app
from .seed import load_supply_chain

app = build_app(seed_fn=load_supply_chain)
