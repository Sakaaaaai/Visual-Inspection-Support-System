from __future__ import annotations

import atexit
import mimetypes
import os
import threading
import webbrowser
from pathlib import Path

from flask import Flask, jsonify, render_template, request, send_file

from animal_assistant.workbook import ANIMAL_OPTIONS, AnimalWorkbook, WorkbookFormatError


app = Flask(__name__)
session: AnimalWorkbook | None = None
session_lock = threading.RLock()


def _error(message: str, status: int = 400):
    return jsonify({"ok": False, "error": message}), status


def _require_session() -> AnimalWorkbook:
    if session is None:
        raise WorkbookFormatError("解析結果フォルダを先に開いてください。")
    return session


def _summary(book: AnimalWorkbook) -> dict:
    return {
        "batchDir": str(book.batch_dir),
        "workbook": book.path.name,
        "deviceNumber": book.device_number,
        "analysisDate": book.analysis_date,
        "total": len(book.rows),
        "completed": book.completed_count(),
        "animals": ANIMAL_OPTIONS,
        "backup": str(book.backup_path) if book.backup_path else None,
    }


@app.get("/")
def index():
    return render_template("index.html")


@app.post("/api/choose-folder")
def choose_folder():
    try:
        import tkinter as tk
        from tkinter import filedialog

        root = tk.Tk()
        root.withdraw()
        root.attributes("-topmost", True)
        selected = filedialog.askdirectory(title="解析結果フォルダを選択")
        root.destroy()
        return jsonify({"ok": True, "path": selected})
    except Exception as exc:
        return _error(f"フォルダ選択画面を開けませんでした: {exc}", 500)


@app.post("/api/open")
def open_batch():
    global session
    payload = request.get_json(silent=True) or {}
    batch_dir = str(payload.get("path", "")).strip()
    if not batch_dir:
        return _error("解析結果フォルダを指定してください。")
    try:
        new_session = AnimalWorkbook.open_batch(batch_dir)
        with session_lock:
            old_session = session
            session = new_session
            if old_session is not None:
                old_session.close()
            result = _summary(new_session)
            result["row"] = new_session.row_data(0)
        return jsonify({"ok": True, **result})
    except (OSError, WorkbookFormatError, ValueError) as exc:
        return _error(str(exc))


@app.get("/api/row/<int:index_value>")
def get_row(index_value: int):
    try:
        with session_lock:
            book = _require_session()
            if index_value < 0 or index_value >= len(book.rows):
                return _error("対象行が範囲外です。", 404)
            return jsonify({"ok": True, "row": book.row_data(index_value), **_summary(book)})
    except (OSError, WorkbookFormatError, ValueError) as exc:
        return _error(str(exc))


@app.get("/api/image/<int:index_value>")
def get_image(index_value: int):
    try:
        with session_lock:
            book = _require_session()
            if index_value < 0 or index_value >= len(book.rows):
                return _error("対象行が範囲外です。", 404)
            image_path = book.image_path_for_row(book.rows[index_value])
            if not image_path.is_file():
                return _error(f"画像が見つかりません: {image_path}", 404)
            mime = mimetypes.guess_type(image_path.name)[0] or "application/octet-stream"
            return send_file(image_path, mimetype=mime, conditional=True)
    except (OSError, WorkbookFormatError, ValueError) as exc:
        return _error(str(exc), 404)


@app.get("/api/context-image/<int:index_value>/<int:context_position>")
def get_context_image(index_value: int, context_position: int):
    try:
        with session_lock:
            book = _require_session()
            if index_value < 0 or index_value >= len(book.rows):
                return _error("対象行が範囲外です。", 404)
            image_path = book.context_image_path(index_value, context_position)
            if not image_path.is_file():
                return _error(f"参考画像が見つかりません: {image_path}", 404)
            mime = mimetypes.guess_type(image_path.name)[0] or "application/octet-stream"
            return send_file(image_path, mimetype=mime, conditional=True)
    except (IndexError, OSError, WorkbookFormatError, ValueError) as exc:
        return _error(str(exc), 404)


@app.post("/api/save")
def save_review():
    payload = request.get_json(silent=True) or {}
    try:
        index_value = int(payload.get("index"))
        selected_animal = str(payload.get("animal", "")).strip()
        count = payload.get("count", "")
        with session_lock:
            book = _require_session()
            row = book.save_review(index_value, selected_animal, count)
            return jsonify({"ok": True, "row": row, **_summary(book)})
    except PermissionError as exc:
        winerror = getattr(exc, "winerror", None)
        if winerror in (5, 32):
            return _error(
                "対象ExcelがMicrosoft Excelなどで開かれているため保存できません。"
                "対象Excelを閉じてから、もう一度「保存して次へ」を押してください。"
                "入力内容は画面に残っています。"
            )
        return _error(f"保存先へのアクセスが拒否されました: {exc}")
    except OSError as exc:
        winerror = getattr(exc, "winerror", None)
        if winerror in (5, 32):
            return _error(
                "対象Excelまたは保存先フォルダが他のアプリで使用されています。"
                "Excelとエクスプローラーのプレビューを閉じてから、もう一度保存してください。"
                "入力内容は画面に残っています。"
            )
        return _error(f"保存できませんでした: {exc}")
    except (TypeError, ValueError, WorkbookFormatError) as exc:
        return _error(f"保存できませんでした: {exc}")


@app.get("/api/next-unreviewed/<int:index_value>")
def next_unreviewed(index_value: int):
    try:
        with session_lock:
            book = _require_session()
            next_index = book.next_with_status(index_value, ["pending"])
            return jsonify({"ok": True, "index": next_index, **_summary(book)})
    except (OSError, WorkbookFormatError, ValueError) as exc:
        return _error(str(exc))


@app.get("/api/next-hold/<int:index_value>")
def next_hold(index_value: int):
    try:
        with session_lock:
            book = _require_session()
            next_index = book.next_with_status(index_value, ["hold"])
            return jsonify({"ok": True, "index": next_index, **_summary(book)})
    except (OSError, WorkbookFormatError, ValueError) as exc:
        return _error(str(exc))


@app.get("/api/animals")
def get_animals():
    try:
        with session_lock:
            book = _require_session()
            groups = book.rows_by_animal()
            animal_list = []
            all_indices = []
            all_reviewed_count = 0
            for animal_name, indices in groups.items():
                reviewed_count = sum(
                    1 for idx in indices
                    if book.grid_row_data(idx)["status"] == "reviewed"
                )
                animal_list.append({
                    "name": animal_name,
                    "total": len(indices),
                    "reviewed": reviewed_count,
                })
                all_indices.extend(indices)
                all_reviewed_count += reviewed_count
            
            animal_list.insert(0, {
                "name": "すべて",
                "total": len(all_indices),
                "reviewed": all_reviewed_count,
            })
            return jsonify({
                "ok": True,
                **_summary(book),
                "gridAnimals": animal_list,
            })
    except (OSError, WorkbookFormatError, ValueError) as exc:
        return _error(str(exc))


@app.get("/api/animal-indices/<animal_name>")
def get_animal_indices(animal_name: str):
    try:
        with session_lock:
            book = _require_session()
            groups = book.rows_by_animal()
            indices = groups.get(animal_name, [])
            return jsonify({"ok": True, "animal": animal_name, "indices": indices})
    except (OSError, WorkbookFormatError, ValueError) as exc:
        return _error(str(exc))


@app.get("/api/grid/<animal_name>")
def get_grid(animal_name: str):
    try:
        page = request.args.get("page", 0, type=int)
        per_page = request.args.get("per_page", 12, type=int)
        with session_lock:
            book = _require_session()
            groups = book.rows_by_animal()
            if animal_name == "すべて":
                indices = []
                for idxs in groups.values():
                    indices.extend(idxs)
                indices.sort()
            else:
                indices = groups.get(animal_name, [])
            total_pages = max(1, -(-len(indices) // per_page))
            page = max(0, min(page, total_pages - 1))
            page_indices = indices[page * per_page: (page + 1) * per_page]
            rows = [book.grid_row_data(idx) for idx in page_indices]
            return jsonify({
                "ok": True,
                "animal": animal_name,
                "page": page,
                "totalPages": total_pages,
                "totalImages": len(indices),
                "rows": rows,
                **_summary(book),
            })
    except (OSError, WorkbookFormatError, ValueError) as exc:
        return _error(str(exc))


@app.post("/api/confirm")
def confirm_predictions():
    payload = request.get_json(silent=True) or {}
    try:
        indices = payload.get("indices", [])
        animal = payload.get("animal")
        count = payload.get("count")
        
        if not isinstance(indices, list) or not indices:
            return _error("確認する画像を選択してください。")
            
        with session_lock:
            book = _require_session()
            if animal is not None and count is not None:
                confirmed_count = book.save_review_bulk(indices, animal, count)
            else:
                confirmed_count = book.confirm_predictions_bulk(indices)
            return jsonify({"ok": True, "confirmed": confirmed_count, **_summary(book)})
    except PermissionError as exc:
        winerror = getattr(exc, "winerror", None)
        if winerror in (5, 32):
            return _error(
                "対象ExcelがMicrosoft Excelなどで開かれているため保存できません。"
                "対象Excelを閉じてから、もう一度保存してください。"
            )
        return _error(f"保存先へのアクセスが拒否されました: {exc}")
    except OSError as exc:
        winerror = getattr(exc, "winerror", None)
        if winerror in (5, 32):
            return _error(
                "対象Excelまたは保存先フォルダが他のアプリで使用されています。"
                "Excelとエクスプローラーのプレビューを閉じてから、もう一度保存してください。"
            )
        return _error(f"保存できませんでした: {exc}")
    except (TypeError, ValueError, WorkbookFormatError) as exc:
        return _error(f"保存できませんでした: {exc}")


@app.post("/api/hold")
def hold_images():
    payload = request.get_json(silent=True) or {}
    try:
        indices = payload.get("indices", [])
        if not isinstance(indices, list) or not indices:
            return _error("保留する画像を選択してください。")
            
        with session_lock:
            book = _require_session()
            confirmed_count = book.save_review_bulk(indices, "保留", "")
            return jsonify({"ok": True, "confirmed": confirmed_count, **_summary(book)})
    except PermissionError as exc:
        winerror = getattr(exc, "winerror", None)
        if winerror in (5, 32):
            return _error(
                "対象ExcelがMicrosoft Excelなどで開かれているため保存できません。"
                "対象Excelを閉じてから、もう一度保存してください。"
            )
        return _error(f"保存先へのアクセスが拒否されました: {exc}")
    except OSError as exc:
        winerror = getattr(exc, "winerror", None)
        if winerror in (5, 32):
            return _error(
                "対象Excelまたは保存先フォルダが他のアプリで使用されています。"
                "Excelとエクスプローラーのプレビューを閉じてから、もう一度保存してください。"
            )
        return _error(f"保存できませんでした: {exc}")
    except (TypeError, ValueError, WorkbookFormatError) as exc:
        return _error(f"保存できませんでした: {exc}")


@atexit.register
def close_workbook():
    if session is not None:
        session.close()


def main():
    url = "http://127.0.0.1:8765"
    if os.environ.get("ANIMAL_ASSISTANT_NO_BROWSER") != "1":
        threading.Timer(1.0, lambda: webbrowser.open(url)).start()
    # threaded=False: choose_folder() opens a tkinter dialog, which on macOS must run
    # on the main thread. A threaded server would dispatch it to a worker thread and
    # hang/crash. This app is single-user/local, so serializing requests is fine.
    app.run(host="127.0.0.1", port=8765, debug=False, threaded=False, use_reloader=False)


if __name__ == "__main__":
    main()
