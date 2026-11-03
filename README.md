# Trang quét mã vạch / QR bằng camera

Trang web tĩnh (`index.html` + `code128.js`) dùng camera điện thoại để đọc Code128, Code39 và QR.
Trang **không biết gì về dữ liệu**: nó chỉ đọc mã rồi gửi về app đã mở nó. Việc tra cứu, lưu trữ do app làm.

Lý do tồn tại: khung iframe của Google Apps Script chặn camera, nên app mở trang này ở **tab mới** (HTTPS riêng, ví dụ GitHub Pages) và nhận mã qua `postMessage`.

Địa chỉ đang dùng: `https://tintaotbs-arch.github.io/scanner/`

---

## 1. Dành cho người dùng app MMTB

### Quét một lần
Dùng ở form Yêu cầu, Bảo trì, hộp quét ở thanh trên và form Kiểm kê.

1. Bấm nút **Quét mã** (hoặc biểu tượng quét). Hộp quét hiện ra.
2. Bấm vào khung **Quét bằng camera**. Camera mở ở tab mới, cho phép quyền camera nếu máy hỏi.
3. Đưa vạch vào khung, giữ máy cách tem khoảng 15–25 cm. Đọc xong tab tự đóng và mã về app.
4. Vạch hỏng thì chuyển sang tab **Nhập tay**, gõ đủ mã hoặc 4–6 số cuối rồi chọn máy trong danh sách.

### Quét liên tục (Kiểm kê)
Dùng khi kiểm kê nhiều máy liền nhau.

1. Tab **Kiểm kê** → chọn kỳ đang mở → **Kiểm kê mới** → **Quét liên tục**.
2. Chọn **Vị trí đang kiểm** (ít nhất Line). Máy nằm ngoài phạm vi kỳ sẽ được đổi về vị trí này.
3. Camera mở ở tab mới và giữ mở. Quét lần lượt từng tem. Khung ở đáy màn hình báo kết quả:
   - xanh **Đã nhận**: thêm vào danh sách chờ (máy rung 1 lần);
   - cam **Mã này đã quét rồi**: trùng (rung 2 lần);
   - đỏ: lỗi, ví dụ đã kiểm kê trong kỳ này hoặc mã không phải 12 số.
4. Quét xong bấm **Hoàn thành** trên trang camera, quay lại app.
5. Trong app, xem danh sách: chỉnh tình trạng từng máy, bỏ dòng sai, rồi **Lưu tất cả**. Dòng nào lỗi sẽ còn lại kèm lý do.
6. Phiếu đã lưu vẫn cần **Update vào MMTB** như quét một lần.

Lưu ý: không đóng hộp "Quét liên tục" khi còn máy chưa lưu (app sẽ cảnh báo, bấm lần hai mới bỏ). Tem còn nằm trong khung thì không rung lặp lại, đưa tem ra rồi vào lại mới tính là quét lần nữa.

---

## 2. Dành cho lập trình viên: dùng trong app khác

### Mở trang

```js
const rid = Math.random().toString(36).slice(2);
const origin = location.origin === 'null' ? '*' : location.origin; // iframe Apps Script có origin 'null'
const url = SCANNER_URL + '?o=' + encodeURIComponent(origin) + '&rid=' + rid
          + '&t=' + encodeURIComponent('Quét tem tài sản'); // tùy chọn
// Phải gọi trong lúc xử lý thao tác bấm của người dùng, nếu không trình duyệt chặn popup
const win = window.open(url, '_blank');
```

| Tham số | Bắt buộc | Ý nghĩa |
|---|---|---|
| `o` | có | origin của app. Mã chỉ được gửi cho đúng origin này (`*` nếu app chạy trong iframe Apps Script). |
| `rid` | có | mã yêu cầu ngẫu nhiên, app dùng để lọc tin nhắn. |
| `c=1` | không | quét liên tục: gửi mã nhưng giữ camera mở. Không có thì quét 1 mã rồi tự đóng tab. |
| `t` | không | tiêu đề trang. Mặc định "Quét mã vạch / QR". |
| `p` | không | tiền tố tên tin nhắn. Mặc định rỗng → `scan`; `p=mmtb-` → `mmtb-scan`. |

### Nhận mã

```js
window.addEventListener('message', e => {
  // Chỉ nhận từ tab mình mở và đúng rid (origin của iframe Apps Script là 'null' nên không so được origin)
  if (e.source !== win || !e.data || e.data.rid !== rid || e.data.type !== 'scan') return;
  console.log(e.data.code);
});
```

Tin nhắn từ scanner gửi tới app:

| `type` | Dữ liệu | Khi nào |
|---|---|---|
| `scan` | `{ code, rid }` | đọc được một mã |
| `scan-error` | `{ error, rid }` | camera bị chặn khi trang chạy trong iframe |

(với `p=mmtb-` thì tên là `mmtb-scan`, `mmtb-scan-error`.)

### Quét liên tục: app phản hồi từng mã (không bắt buộc)

App gửi ngược cho tab scanner (`win.postMessage(msg, scannerOrigin)`) để trang hiện khung màu:

| `type` | Dữ liệu | Tác dụng |
|---|---|---|
| `scan-ack` | `{ rid, code, ok, dup, msg }` | `ok` → khung xanh "Đã nhận"; `dup` → khung cam "đã quét rồi"; còn lại → khung đỏ kèm `msg`. |
| `scan-stop` | `{ rid }` | dừng camera và đóng tab (gửi khi app đóng phiên quét). |

Không gửi ack thì khung chỉ hiện "Đang kiểm tra..." rồi tự ẩn, mã vẫn về bình thường.

### Quy tắc nên theo
- **Lọc tin nhắn** bằng `e.source` và `rid`, không tin nội dung nào khác.
- Mã trùng: scanner chỉ gửi lại một mã sau khi mã đó vắng khỏi khung hơn 4 giây. App vẫn nên tự chống trùng.
- Xử lý mã đọc về như dữ liệu người dùng nhập: kiểm tra định dạng trước khi dùng.
- Tab được mở bằng một cú bấm của người dùng, và nút "Hoàn thành" chỉ đóng được tab do app mở.

### App MMTB đang dùng
`Script.html` (`openLiveScanner`, `kkQueueAdd`) và `YCau.html` (`openLiveScanner`) mở trang với `&p=mmtb-&t=Quét tem MMTB`, nên dùng các tên `mmtb-scan`, `mmtb-scan-ack`, `mmtb-scan-stop`.

---

## 3. Cập nhật / triển khai trang scanner

1. Sửa `index.html` (và `code128.js` nếu cần) trong repo GitHub Pages rồi push.
2. Trang dùng chung cho mọi app: **sửa là ảnh hưởng tất cả**. Giữ nguyên tên tin nhắn và tham số ở trên; trang vẫn nhận cả tên cũ `mmtb-scan-ack` / `mmtb-scan-stop`.
3. Đổi tên tin nhắn chỉ làm khi đã đẩy app lên trước, scanner lên sau, để không có lúc hai bên lệch nhau.
4. Repo này là nguồn của trang scanner (thư mục `C:\WorkSpace T\MMTB-scan`), tách khỏi các app Apps Script: không đi theo clasp hay fanout.
