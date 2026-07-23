from __future__ import annotations

from pathlib import Path

MODEL_PATH = "line-corporation/clip-japanese-base-v2"

# CLIP text prompt (Japanese label) -> ANIMAL_OPTIONS string
LABELS: dict[str, str] = {
    "アナグマ": "badger（アナグマ）",
    "クマ": "bear（クマ）",
    "イノシシ": "boar（イノシシ）",
    "クルマ": "car（クルマ）",
    "ネコ": "cat（ネコ）",
    "カラス": "craw（カラス）",
    "シカ": "deer（シカ）",
    "イヌ": "dog（イヌ）",
    "キツネ": "fox（キツネ）",
    "ヒト": "man（ヒト）",
    "ハクビシン": "maskedmusang（ハクビシン）",
    "サル": "monkey（サル）",
    "ウサギ": "rabbit（ウサギ）",
    "アライグマ": "racoon（アライグマ）",
    "タヌキ": "racoondog（タヌキ）",
    "カモシカ": "serow（カモシカ）",
    "動物がいない風景": "いない",
}
_LABEL_TEXTS = list(LABELS.keys())

_state: dict = {}


class AIInferenceError(RuntimeError):
    pass


def _load() -> None:
    if _state:
        return
    try:
        import torch
        from transformers import AutoImageProcessor, AutoModel, AutoTokenizer
    except ImportError as exc:
        raise AIInferenceError(
            "AI推論に必要なライブラリ（torch/transformers）がインストールされていません。"
        ) from exc

    tokenizer = AutoTokenizer.from_pretrained(MODEL_PATH, trust_remote_code=True)
    processor = AutoImageProcessor.from_pretrained(MODEL_PATH, trust_remote_code=True)
    model = AutoModel.from_pretrained(MODEL_PATH, trust_remote_code=True)
    model.eval()

    text_inputs = tokenizer(_LABEL_TEXTS)
    with torch.no_grad():
        text_features = model.get_text_features(**text_inputs)
    text_features = text_features / text_features.norm(dim=-1, keepdim=True)

    _state.update(
        torch=torch,
        model=model,
        processor=processor,
        text_features=text_features,
    )


def classify_image(image_path: Path) -> tuple[str, float]:
    """Return (ANIMAL_OPTIONS string, confidence in [0, 1]) for the given image.

    Uses zero-shot classification with a general-purpose Japanese CLIP model
    (line-corporation/clip-japanese-base-v2). This is a first-pass AI opinion,
    separate from the device/server prediction already in the workbook -- not
    a replacement for it.
    """
    _load()
    torch = _state["torch"]
    model = _state["model"]
    processor = _state["processor"]
    text_features = _state["text_features"]

    from PIL import Image

    image = Image.open(image_path).convert("RGB")
    pixel_values = processor(image, return_tensors="pt")
    with torch.no_grad():
        image_features = model.get_image_features(**pixel_values)
        image_features = image_features / image_features.norm(dim=-1, keepdim=True)
        probs = (100.0 * image_features @ text_features.T).softmax(dim=-1)[0]

    top_idx = int(probs.argmax())
    return LABELS[_LABEL_TEXTS[top_idx]], float(probs[top_idx])
