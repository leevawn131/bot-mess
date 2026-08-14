// Game Đuổi Hình Bắt Chữ - Canvas Edition
const { createCanvas } = require('@napi-rs/canvas');
const fs = require('fs');
const path = require('path');
const { checkCooldown } = require('../../utils/cooldown');
const prefix = process.env.BOT_PREFIX || '!';

const puzzles = [
    { emoji: "🌧️🧥", answer: "Áo mưa", hints: ["Vật dụng dùng khi trời mưa", "Mặc bên ngoài", "Giữ cơ thể khô ráo"], category: "Đời sống" },
    { emoji: "📖👓", answer: "Đọc sách", hints: ["Hành động xem và tiếp thu kiến thức từ trang sách", "Hoạt động học tập", "Tăng hiểu biết"], category: "Học tập" },
    { emoji: "🍚🐟", answer: "Cơm cá", hints: ["Món ăn gia đình quen thuộc", "Có tinh bột và đạm", "Ăn bằng đũa"], category: "Ẩm thực" },
    { emoji: "🚗💨", answer: "Lái xe", hints: ["Hành động điều khiển phương tiện trên đường", "Có vô lăng", "Di chuyển giao thông"], category: "Giao thông" },
    { emoji: "🌞🕶️", answer: "Kính râm", hints: ["Vật dụng / phụ kiện thời trang đeo mắt", "Dùng khi trời nắng", "Bảo vệ mắt"], category: "Thời trang" },
    { emoji: "🏠🧹", answer: "Dọn nhà", hints: ["Hành động lau chùi vệ sinh không gian sống", "Việc nội trợ", "Nhà cửa gọn gàng"], category: "Đời sống" },
    { emoji: "🔥🍳", answer: "Nấu ăn", hints: ["Hành động chế biến thực phẩm trong bếp", "Dùng nồi chảo", "Tạo ra món ăn"], category: "Ẩm thực" },
    { emoji: "🚌🏫", answer: "Đi học", hints: ["Hành động di chuyển đến trường để tiếp thu kiến thức", "Có thầy cô", "Có bài tập"], category: "Học tập" },
    { emoji: "💰🏦", answer: "Gửi tiết kiệm", hints: ["Hành động tích lũy tiền vào ngân hàng", "Liên quan tài chính", "Có lãi suất"], category: "Tài chính" },
    { emoji: "⚽🥅", answer: "Ghi bàn", hints: ["Hành động sút đưa bóng vào lưới đối phương", "Trong bóng đá", "Mang điểm số"], category: "Thể thao" },
    { emoji: "🎂🕯️", answer: "Sinh nhật", hints: ["Sự kiện kỷ niệm ngày sinh", "Có bánh kem và nến", "Mỗi năm một lần"], category: "Lễ hội" },
    { emoji: "🎁💌", answer: "Quà tặng", hints: ["Vật phẩm gửi tới người khác để thể hiện tình cảm", "Gói đẹp", "Trao trong dịp đặc biệt"], category: "Đời sống" },
    { emoji: "🚲🏞️", answer: "Đạp xe", hints: ["Hành động điều khiển xe hai bánh bằng sức chân", "Tốt cho sức khỏe", "Có bàn đạp"], category: "Thể thao" },
    { emoji: "📷🌄", answer: "Chụp ảnh", hints: ["Hành động bắt trọn khoảnh khắc bằng máy ảnh/điện thoại", "Lưu kỉ niệm", "Có khung hình"], category: "Giải trí" },
    { emoji: "🛏️🌙", answer: "Ngủ ngon", hints: ["Hành động nghỉ ngơi chìm vào giấc ngủ ban đêm", "Nằm trên giường", "Hồi phục sức khỏe"], category: "Đời sống" },
    { emoji: "🧃🧊", answer: "Nước lạnh", hints: ["Đồ uống giải khát", "Có đá", "Mát cổ"], category: "Ẩm thực" },
    { emoji: "🌳💨", answer: "Gió mát", hints: ["Hiện tượng tự nhiên mang làn khí dễ chịu", "Ở ngoài trời", "Lay động lá cây"], category: "Tự nhiên" },
    { emoji: "☕🥐", answer: "Bữa sáng", hints: ["Bữa ăn đầu tiên trong ngày", "Giúp có năng lượng", "Không nên bỏ"], category: "Ẩm thực" },
    { emoji: "🧠📝", answer: "Ghi nhớ", hints: ["Hành động tiếp thu và lưu giữ kiến thức trong trí não", "Giúp học tốt", "Tránh quên"], category: "Học tập" },
    { emoji: "🔒🚪", answer: "Khóa cửa", hints: ["Hành động chốt khóa cửa để đảm bảo an toàn", "Dùng chìa khóa", "Làm trước khi ra ngoài"], category: "Đời sống" },
    { emoji: "💻📶", answer: "Kết nối mạng", hints: ["Hành động truy cập kết nối internet / Wi-Fi", "Dùng thiết bị công nghệ", "Phục vụ làm việc"], category: "Công nghệ" },
    { emoji: "📱🔋", answer: "Sạc pin", hints: ["Hành động nạp điện năng cho thiết bị / điện thoại", "Cắm dây sạc", "Tăng phần trăm pin"], category: "Công nghệ" },
    { emoji: "🧴🧼", answer: "Rửa mặt", hints: ["Hành động làm sạch da mặt bằng nước / sữa rửa mặt", "Chăm sóc cá nhân", "Thường làm sáng tối"], category: "Đời sống" },
    { emoji: "🦷🪥", answer: "Đánh răng", hints: ["Hành động vệ sinh răng miệng bằng bàn chải", "Chăm sóc cá nhân", "Giữ hơi thở thơm"], category: "Đời sống" },
    { emoji: "👕🧺", answer: "Giặt đồ", hints: ["Hành động làm sạch quần áo bằng nước và xà phòng", "Việc nhà", "Phơi sau khi xong"], category: "Đời sống" },
    { emoji: "🌸🐝", answer: "Hoa nở", hints: ["Hiện tượng/hành động hoa bung nở cánh", "Thường vào mùa xuân", "Có ong bướm"], category: "Tự nhiên" },
    { emoji: "🌊🏄", answer: "Lướt sóng", hints: ["Hành động/môn thể thao di chuyển trên ngọn sóng biển", "Dùng ván lướt", "Cần thăng bằng"], category: "Thể thao" },
    { emoji: "🗺️🧭", answer: "Chỉ đường", hints: ["Hành động hướng dẫn phương hướng vị trí cho người khác", "Dùng bản đồ", "Giúp tìm nơi"], category: "Đời sống" },
    { emoji: "🚦🚶", answer: "Qua đường", hints: ["Hành động đi băng sang phía bên kia đường", "Người đi bộ", "Cần an toàn"], category: "Giao thông" },
    { emoji: "🍜🥢", answer: "Ăn mì", hints: ["Hành động thưởng thức món ăn dạng sợi", "Dùng đũa gắp", "Ăn nóng"], category: "Ẩm thực" },
    { emoji: "🍉🔪", answer: "Cắt dưa", hints: ["Hành động dùng dao bổ quả dưa", "Trái cây mùa hè", "Ruột đỏ"], category: "Ẩm thực" },
    { emoji: "🌋🔥", answer: "Núi lửa", hints: ["Hiện tượng địa chất phun trào dung nham", "Màu đỏ ngọn lửa", "Rất nóng"], category: "Tự nhiên" },
    { emoji: "❄️⛰️", answer: "Núi tuyết", hints: ["Khung cảnh vùng núi phủ đầy tuyết lạnh", "Màu trắng", "Vùng cao"], category: "Tự nhiên" },
    { emoji: "🎤🎶", answer: "Ca sĩ", hints: ["Danh xưng/nghề nghiệp người thể hiện bài hát", "Dùng micro", "Biểu diễn âm nhạc"], category: "Nghệ thuật" },
    { emoji: "🎻🎵", answer: "Chơi đàn", hints: ["Hành động đánh/gảy nhạc cụ tạo ra giai điệu", "Âm nhạc", "Cần luyện tập"], category: "Nghệ thuật" },
    { emoji: "📺🛋️", answer: "Xem phim", hints: ["Hành động theo dõi tác phẩm điện ảnh trên màn hình", "Giải trí gia đình", "Có cốt truyện"], category: "Giải trí" },
    { emoji: "🐶🦴", answer: "Cho chó ăn", hints: ["Hành động cung cấp thức ăn cho thú cưng", "Con vật trung thành", "Làm hằng ngày"], category: "Đời sống" },
    { emoji: "🐱🧶", answer: "Mèo chơi len", hints: ["Hành động con mèo đùa nghịch với cuộn dây len", "Thú cưng dễ thương"], category: "Đời sống" },
    { emoji: "🌙⭐", answer: "Đêm sao", hints: ["Khung cảnh bầu trời ban đêm rực rỡ lấp lánh", "Có mặt trăng và ngôi sao", "Lãng mạn"], category: "Tự nhiên" },
    { emoji: "🌅🏃", answer: "Chạy bộ", hints: ["Hành động thể dục di chuyển bước nhanh bằng chân", "Không cần dụng cụ", "Tốt cho tim mạch"], category: "Thể thao" },
    { emoji: "🍞🧈", answer: "Bánh mì bơ", hints: ["Món ăn nướng quết bơ thơm ngon", "Bữa sáng nhanh", "Có bánh mì"], category: "Ẩm thực" },
    { emoji: "🍲🥄", answer: "Canh nóng", hints: ["Món ăn dạng nước phục vụ khi còn bốc hơi", "Dùng muỗng", "Ăn cùng cơm"], category: "Ẩm thực" },
    { emoji: "🧂🍲", answer: "Nêm muối", hints: ["Hành động cho muối vào món ăn khi nấu", "Gia vị mặn", "Tăng vị đậm đà"], category: "Ẩm thực" },
    { emoji: "🧯🔥", answer: "Chữa cháy", hints: ["Hành động dập tắt ngọn lửa cứu hỏa", "Tình huống khẩn cấp", "Dùng bình cứu hỏa"], category: "Đời sống" },
    { emoji: "🚑🏥", answer: "Cấp cứu", hints: ["Hành động y tế khẩn cấp cứu chữa người bệnh", "Có xe cứu thương", "Đến bệnh viện"], category: "Y tế" },
    { emoji: "🚓👮", answer: "Cảnh sát", hints: ["Nghề nghiệp/lực lượng giữ gìn an ninh trật tự", "Mặc đồng phục", "Liên quan pháp luật"], category: "Nghề nghiệp" },
    { emoji: "🚒💦", answer: "Xe cứu hỏa", hints: ["Phương tiện chuyên dụng dùng để dập lửa", "Màu đỏ", "Có vòi nước"], category: "Cứu hộ" },
    { emoji: "🧑‍🍳🍰", answer: "Làm bánh", hints: ["Hành động nhào nặn chế biến món bánh ngọt", "Trong bếp", "Có bột và đường"], category: "Ẩm thực" },
    { emoji: "🏊‍♂️🏅", answer: "Bơi lội", hints: ["Hành động/môn thể thao di chuyển dưới nước", "Có hồ bơi", "Tốt cho sức khỏe"], category: "Thể thao" },
    { emoji: "🏸🏟️", answer: "Đánh cầu lông", hints: ["Hành động dùng vợt đánh quả cầu qua lại", "Môn thể thao đối kháng", "Có quả cầu"], category: "Thể thao" },
    { emoji: "🏀⛹️", answer: "Bóng rổ", hints: ["Môn thể thao ném bóng cam vào rổ", "Có rổ cao", "Ghi điểm bằng cách ném bóng"], category: "Thể thao" },
    { emoji: "🎯🏹", answer: "Bắn cung", hints: ["Hành động giương cung ngắm bắn tên vào bia", "Có cung tên", "Cần tập trung"], category: "Thể thao" },
    { emoji: "🚴‍♂️⛰️", answer: "Đua xe đạp", hints: ["Hành động tranh tốc độ điều khiển xe đạp", "Môn thể thao sức bền", "Thi đấu"], category: "Thể thao" },
    { emoji: "🧗‍♂️🪨", answer: "Leo núi", hints: ["Hành động trèo lên vách đá / đỉnh núi mạo hiểm", "Cần dây bảo hộ", "Rèn thể lực"], category: "Thể thao" },
    { emoji: "🥋🏆", answer: "Võ sĩ", hints: ["Người/vận động viên chuyên tập luyện thi đấu võ thuật", "Kỷ luật cao", "Có đai võ"], category: "Nghề nghiệp" },
    { emoji: "🧘‍♀️🕯️", answer: "Thiền định", hints: ["Hành động ngồi tịnh tâm tập trung hơi thở", "Giảm căng thẳng", "Tập trung tinh thần"], category: "Đời sống" },
    { emoji: "📦🚚", answer: "Giao hàng", hints: ["Hành động vận chuyển đưa kiện hàng đến tay người nhận", "Dịch vụ shipper", "Vận chuyển"], category: "Dịch vụ" },
    { emoji: "🛒🧾", answer: "Đi chợ", hints: ["Hành động ra chợ / siêu thị mua sắm thực phẩm", "Có giỏ hàng", "Chuẩn bị bữa ăn"], category: "Đời sống" },
    { emoji: "🍅🥗", answer: "Làm salad", hints: ["Hành động trộn rau củ quả thành món salad", "Món ăn thanh mát", "Ít dầu mỡ"], category: "Ẩm thực" },
    { emoji: "🧁🍓", answer: "Bánh ngọt", hints: ["Món tráng miệng làm từ bột đường sữa", "Có vị ngọt", "Hợp tiệc sinh nhật"], category: "Ẩm thực" },
    { emoji: "🧊🥤", answer: "Trà đá", hints: ["Đồ uống bình dân phổ biến pha kèm đá", "Giải khát", "Vị trà nhẹ"], category: "Ẩm thực" },
    { emoji: "🍋🍯", answer: "Chanh mật ong", hints: ["Thức uống kết hợp quả chanh và mật ong", "Vị chua ngọt", "Tốt cho cổ họng"], category: "Ẩm thực" },
    { emoji: "🍌🥛", answer: "Sinh tố chuối", hints: ["Đồ uống xay nhuyễn chuối tươi và sữa", "Bổ dưỡng", "Ngon mát"], category: "Ẩm thực" },
    { emoji: "🥥🥤", answer: "Nước dừa", hints: ["Thức uống tự nhiên lấy trực tiếp từ quả dừa", "Mát ngọt", "Đồ uống mùa hè"], category: "Ẩm thực" },
    { emoji: "🌽🔥", answer: "Bắp nướng", hints: ["Món ăn vặt từ trái bắp nướng trên than hồng", "Mùi mỡ hành thơm", "Ăn nóng"], category: "Ẩm thực" },
    { emoji: "🍢🔥", answer: "Xiên nướng", hints: ["Món đường phố xiên que nướng bếp than", "Thịt/chả xiên", "Ăn kèm nước chấm"], category: "Ẩm thực" },
    { emoji: "🍣🐟", answer: "Sushi", hints: ["Món ăn truyền thống Nhật Bản có cơm và hải sản tươi", "Có cá tươi", "Ăn kèm mù tạt"], category: "Ẩm thực" },
    { emoji: "🍱🥢", answer: "Cơm hộp", hints: ["Bữa ăn chuẩn bị sẵn đóng trong hộp", "Tiện lợi", "Mang đi làm/đi học"], category: "Ẩm thực" },
    { emoji: "🍛🍗", answer: "Cà ri gà", hints: ["Món ăn nấu nước sánh màu vàng có thịt gà", "Nấu với nước cốt dừa/khoai", "Ăn với bánh mì/cơm"], category: "Ẩm thực" },
    { emoji: "🥟♨️", answer: "Há cảo", hints: ["Món hấp vỏ bột mỏng bọc nhân thịt/tôm", "Món ăn Trung Hoa", "Chấm nước tương"], category: "Ẩm thực" },
    { emoji: "🧳✈️", answer: "Du lịch", hints: ["Hành động đi chơi tham quan những vùng đất mới xa", "Chuẩn bị hành lý", "Đi máy bay/xe"], category: "Giải trí" },
    { emoji: "🏨🛎️", answer: "Khách sạn", hints: ["Địa điểm dịch vụ lưu trú cho khách du lịch", "Có lễ tân", "Có phòng nghỉ"], category: "Dịch vụ" },
    { emoji: "🧭🏕️", answer: "Cắm trại", hints: ["Hành động dựng lều dã ngoại sinh hoạt ngoài trời", "Gần thiên nhiên", "Có đốt lửa trại"], category: "Giải trí" },
    { emoji: "🔦🌌", answer: "Soi đêm", hints: ["Hành động dùng đèn pin chiếu sáng quan sát trong đêm", "Trời tối", "Dùng đèn pin"], category: "Đời sống" },
    { emoji: "🌧️⛰️", answer: "Mưa rừng", hints: ["Hiện tượng mưa trút xuống khu vực rừng núi", "Thời tiết ẩm ướt", "Ở vùng núi"], category: "Tự nhiên" },
    { emoji: "🌈☀️", answer: "Cầu vồng", hints: ["Hiện tượng dải sáng 7 màu trên bầu trời", "Thường xuất hiện sau mưa", "Rực rỡ"], category: "Tự nhiên" },
    { emoji: "🌪️🏠", answer: "Bão tố", hints: ["Hiện tượng thời tiết nguy hiểm gió lốc cực mạnh", "Gây thiệt hại", "Cần trú ẩn"], category: "Tự nhiên" },
    { emoji: "🌊🚢", answer: "Đi biển", hints: ["Hành động chuyến đi đến bãi biển nghỉ dưỡng", "Có sóng biển và bãi cát", "Có tàu thuyền"], category: "Giải trí" },
    { emoji: "⛵🌬️", answer: "Thuyền buồm", hints: ["Phương tiện di chuyển trên nước nhờ sức gió", "Có cánh buồm lớn", "Lướt trên sóng"], category: "Phương tiện" },
    { emoji: "🚆🛤️", answer: "Tàu hỏa", hints: ["Phương tiện giao thông chạy trên đường ray", "Có nhiều toa", "Chở khách/hàng"], category: "Giao thông" },
    { emoji: "🚕📍", answer: "Bắt taxi", hints: ["Hành động vẫy / đặt xe taxi để di chuyển", "Có điểm đón", "Trả tiền theo km"], category: "Giao thông" },
    { emoji: "🛵🛣️", answer: "Chạy xe máy", hints: ["Hành động điều khiển xe máy lưu thông trên đường", "Đội mũ bảo hiểm", "Hai bánh"], category: "Giao thông" },
    { emoji: "⛽🚗", answer: "Đổ xăng", hints: ["Hành động nạp nhiên liệu xăng vào bình xe", "Thực hiện ở cây xăng", "Dùng vòi bơm"], category: "Đời sống" },
    { emoji: "🧰🔧", answer: "Sửa xe", hints: ["Hành động khắc phục hỏng hóc cho xe cộ", "Dùng cờ lê tô vít", "Thợ kỹ thuật"], category: "Nghề nghiệp" },
    { emoji: "🏦💳", answer: "Rút tiền", hints: ["Hành động lấy tiền mặt từ cây ATM / ngân hàng", "Dùng thẻ ATM", "Tài chính"], category: "Tài chính" },
    { emoji: "🧾💸", answer: "Thanh toán", hints: ["Hành động chi trả tiền cho hóa đơn mua sắm", "Khi mua hàng", "Hoàn tất giao dịch"], category: "Tài chính" },
    { emoji: "💼🏢", answer: "Đi làm", hints: ["Hành động di chuyển đến công ty / nơi làm việc", "Đúng giờ giấc", "Có lương"], category: "Đời sống" },
    { emoji: "🗂️🖊️", answer: "Văn phòng", hints: ["Nơi làm việc của nhân viên công ty", "Có máy tính bàn ghế", "Có hồ sơ tài liệu"], category: "Đời sống" },
    { emoji: "🧑‍🏫📘", answer: "Giáo viên", hints: ["Nghề nghiệp người đứng lớp giảng dạy học sinh", "Truyền đạt kiến thức", "Có giáo án"], category: "Nghề nghiệp" },
    { emoji: "👩‍⚕️💉", answer: "Bác sĩ", hints: ["Nghề nghiệp người khám chữa bệnh cho mọi người", "Làm ở bệnh viện", "Khoác áo blouse"], category: "Nghề nghiệp" },
    { emoji: "👨‍🌾🌾", answer: "Nông dân", hints: ["Nghề nghiệp người làm ruộng trồng lúa hoa màu", "Chịu khó", "Lao động nông nghiệp"], category: "Nghề nghiệp" },
    { emoji: "👷‍♂️🧱", answer: "Công nhân", hints: ["Nghề nghiệp người lao động sản xuất / xây dựng", "Đội mũ bảo hộ", "Làm ở công trường"], category: "Nghề nghiệp" },
    { emoji: "🎨🖌️", answer: "Họa sĩ", hints: ["Nghề nghiệp người sáng tác các bức tranh nghệ thuật", "Dùng cọ và màu", "Vẽ tranh"], category: "Nghề nghiệp" },
    { emoji: "📚✍️", answer: "Tác giả", hints: ["Danh xưng người sáng tác viết nên những cuốn sách", "Có tác phẩm", "Có độc giả"], category: "Nghề nghiệp" },
    { emoji: "🎬🎞️", answer: "Đạo diễn", hints: ["Nghề nghiệp người chỉ đạo sản xuất dàn dựng phim", "Làm việc với diễn viên", "Trường quay"], category: "Nghề nghiệp" },
    { emoji: "🎮🏆", answer: "Game thủ", hints: ["Danh xưng người chơi game chuyên nghiệp", "Có kỹ năng cao", "Thi đấu eSports"], category: "Giải trí" },
    { emoji: "🤖💡", answer: "Trí tuệ nhân tạo", hints: ["Công nghệ máy tính thông minh tự học (AI)", "Hiện đại", "Thuật toán máy học"], category: "Công nghệ" },
    { emoji: "🌐🔐", answer: "Bảo mật mạng", hints: ["Lĩnh vực bảo vệ dữ liệu an toàn trên internet", "Chống hacker", "Mật khẩu mã hóa"], category: "Công nghệ" },
    { emoji: "☁️💾", answer: "Lưu trữ đám mây", hints: ["Dịch vụ lưu dữ liệu trên server online (Cloud)", "Đồng bộ thiết bị", "Không lo mất file"], category: "Công nghệ" },
    { emoji: "📡🛰️", answer: "Vệ tinh", hints: ["Thiết bị nhân tạo bay ngoài không gian Trái Đất", "Thu phát sóng tín hiệu", "Truyền thông"], category: "Công nghệ" },
    { emoji: "🌾🌞", answer: "Mùa gặt", hints: ["Thời điểm nông dân gặt hái thu hoạch lúa chín", "Cánh đồng vàng", "Rộn ràng nông thôn"], category: "Tự nhiên" },
    { emoji: "🪁🌬️", answer: "Thả diều", hints: ["Hành động điều khiển diều bay lên bầu trời", "Trò chơi dân gian", "Cần có gió"], category: "Giải trí" },
    { emoji: "🌕🏮", answer: "Trung thu", hints: ["Lễ hội Tết thiếu nhi vào rằm tháng Tám", "Có rước lồng đèn", "Trăng tròn rực rỡ"], category: "Lễ hội" },
    { emoji: "🥮🍵", answer: "Bánh trung thu", hints: ["Món bánh nướng/dẻo đặc trưng dịp Tết Trung Thu", "Thường dùng với trà", "Có nhân đậu xanh/thập cẩm"], category: "Lễ hội" },
    { emoji: "🧧🎉", answer: "Lì xì", hints: ["Hành động/tục lệ trao phong bao đỏ chúc may mắn", "Dịp Tết Nguyên Đán", "Mừng tuổi"], category: "Lễ hội" },
    { emoji: "🌸🧹", answer: "Dọn Tết", hints: ["Hành động lau chùi trang trí nhà cửa chuẩn bị đón xuân", "Dịp cuối năm", "Đón Tết"], category: "Lễ hội" },
    { emoji: "🏮🐉", answer: "Múa lân", hints: ["Hành động biểu diễn vũ điệu lân rồng theo nhịp trống", "Mang ý nghĩa may mắn", "Ngày khai trương/Tết"], category: "Lễ hội" },
    { emoji: "🎆🌃", answer: "Pháo hoa", hints: ["Sự kiện bắn pháo rực rỡ bầu trời đêm", "Đón giao thừa/lễ lớn", "Nhiều màu sắc"], category: "Lễ hội" },
    { emoji: "📚🏫", answer: "Trường học", hints: ["Địa điểm nơi học sinh đến học tập mỗi ngày", "Có lớp học và thầy cô", "Môi trường giáo dục"], category: "Học tập" },
    { emoji: "🩺🏥", answer: "Khám bệnh", hints: ["Hành động bác sĩ kiểm tra chẩn đoán sức khỏe", "Dùng ống nghe", "Ở bệnh viện/phòng khám"], category: "Y tế" },
    { emoji: "🍲🍚", answer: "Bữa cơm", hints: ["Bữa ăn gia đình có cơm và các món mặn", "Sum họp", "Nấu tại nhà"], category: "Ẩm thực" },
    { emoji: "🧑‍🤝‍🧑🎉", answer: "Tiệc bạn bè", aliases: ["ăn mừng", "tiệc tùng", "tụ họp", "ăn tiệc"], hints: ["Sự kiện tụ họp ăn uống vui chơi cùng bạn bè", "Đông vui", "Có đồ ăn thức uống"], category: "Giải trí" },
    { emoji: "🏖️🏐", answer: "Bóng chuyền bãi biển", hints: ["Môn thể thao đánh bóng qua lưới trên bãi cát biển", "Chơi bằng tay", "Mùa hè"], category: "Thể thao" },
    { emoji: "🕰️📖", answer: "Lịch sử", hints: ["Môn học / lĩnh vực nghiên cứu các sự kiện quá khứ", "Có mốc thời gian", "Sự kiện lịch sử"], category: "Học tập" },
    { emoji: "🔬🧪", answer: "Thí nghiệm", hints: ["Hành động thực hành tiến hành nghiên cứu khoa học", "Trong phòng lab", "Dùng ống nghiệm hóa chất"], category: "Học tập" },
    { emoji: "🧭🌍", answer: "Khám phá", hints: ["Hành động tìm tòi trải nghiệm điều mới lạ ở vùng đất mới", "Có tính phiêu lưu", "Mở rộng tầm mắt"], category: "Giải trí" },
    { emoji: "🎓📜", answer: "Nhận bằng", hints: ["Hành động tiếp nhận bằng tốt nghiệp / chứng chỉ", "Cột mốc học tập", "Lễ tốt nghiệp"], category: "Học tập" },
    { emoji: "🛫🌏", answer: "Xuất ngoại", hints: ["Hành động di chuyển sang nước ngoài", "Đi bằng máy bay", "Cần hộ chiếu passport"], category: "Giải trí" },
    { emoji: "📦🎁", answer: "Gói quà", hints: ["Hành động bọc giấy trang trí hộp quà tặng", "Chuẩn bị tặng người khác", "Dùng băng dính nơ"], category: "Đời sống" },
    { emoji: "🧑‍💼🤝", answer: "Phỏng vấn", hints: ["Hành động trao đổi trả lời câu hỏi khi ứng tuyển xin việc", "Gặp nhà tuyển dụng", "Trực tiếp"], category: "Nghề nghiệp" },
    { emoji: "🛡️⚔️", answer: "Chiến binh", hints: ["Danh xưng nhân vật dũng cảm chiến đấu trên chiến trường", "Có khiên giáp vũ khí", "Mạnh mẽ"], category: "Nghề nghiệp" }
];

global.duoiHinhBatChuSessions = global.duoiHinhBatChuSessions || {};

const normalizeAnswer = (text) => {
    if (!text) return "";
    return text
        .toLowerCase()
        .replace(/đ/g, "d")
        .replace(/Đ/g, "d")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]/g, "");
};

const buildAcceptedList = (puzzle) => {
    const answers = [puzzle.answer, ...(puzzle.aliases || [])];
    const normalized = answers.map(normalizeAnswer);
    return Array.from(new Set(normalized));
};

async function generateDHBCImage({ emoji, category = "Đố vui", reward = 500 }) {
    const width = 1000;
    const height = 460;
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');

    const textFont = 'bold 36px "DejaVu Sans", "Liberation Sans", sans-serif';
    const subFont = '16px "DejaVu Sans", "Liberation Sans", sans-serif';
    const emojiFont = '145px "Noto Color Emoji", "Segoe UI Emoji", sans-serif';

    let formattedEmoji = emoji;
    try {
        const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });
        const graphemes = Array.from(segmenter.segment(emoji), s => s.segment).filter(s => s.trim() !== "");
        formattedEmoji = graphemes.join("  ");
    } catch (e) {
        formattedEmoji = emoji;
    }

    // Background gradient
    const bgGradient = ctx.createLinearGradient(0, 0, width, height);
    bgGradient.addColorStop(0, '#0f0c20');
    bgGradient.addColorStop(0.5, '#1a103c');
    bgGradient.addColorStop(1, '#0d1127');
    ctx.fillStyle = bgGradient;
    ctx.fillRect(0, 0, width, height);

    // Glowing background orbs
    const orb1 = ctx.createRadialGradient(250, 150, 10, 250, 150, 350);
    orb1.addColorStop(0, 'rgba(124, 58, 237, 0.35)');
    orb1.addColorStop(1, 'rgba(124, 58, 237, 0)');
    ctx.fillStyle = orb1;
    ctx.fillRect(0, 0, width, height);

    const orb2 = ctx.createRadialGradient(750, 310, 10, 750, 310, 400);
    orb2.addColorStop(0, 'rgba(6, 182, 212, 0.3)');
    orb2.addColorStop(1, 'rgba(6, 182, 212, 0)');
    ctx.fillStyle = orb2;
    ctx.fillRect(0, 0, width, height);

    // Outer Frame
    const margin = 20;
    const cardW = width - margin * 2;
    const cardH = height - margin * 2;

    ctx.save();
    ctx.beginPath();
    ctx.roundRect(margin, margin, cardW, cardH, 24);
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.stroke();

    // Inner Card Container
    const pad = 35;
    const innerX = margin + pad;
    const innerY = margin + pad;
    const innerW = cardW - pad * 2;
    const innerH = cardH - pad * 2;

    ctx.beginPath();
    ctx.roundRect(innerX, innerY, innerW, innerH, 18);
    ctx.fillStyle = 'rgba(15, 23, 42, 0.65)';
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = 'rgba(99, 102, 241, 0.4)';
    ctx.stroke();

    // Title Section
    ctx.fillStyle = '#ffffff';
    ctx.font = textFont;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.shadowColor = 'rgba(168, 85, 247, 0.8)';
    ctx.shadowBlur = 15;
    ctx.fillText('ĐUỔI HÌNH BẮT CHỮ', width / 2, innerY + 25);
    ctx.shadowBlur = 0; // Reset shadow

    // Badges Section
    const badgeY = innerY + 75;
    
    // Category Badge
    ctx.font = subFont;
    const catText = `Chủ đề: ${category}`;
    const catWidth = ctx.measureText(catText).width + 24;
    const catX = width / 2 - catWidth - 10;
    
    ctx.beginPath();
    ctx.roundRect(catX, badgeY, catWidth, 28, 14);
    ctx.fillStyle = 'rgba(147, 51, 234, 0.4)';
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(192, 132, 252, 0.6)';
    ctx.stroke();

    ctx.fillStyle = '#e9d5ff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(catText, catX + catWidth / 2, badgeY + 14);

    // Reward Badge
    const rewText = `Thưởng: +${reward} xu`;
    const rewWidth = ctx.measureText(rewText).width + 24;
    const rewX = width / 2 + 10;

    ctx.beginPath();
    ctx.roundRect(rewX, badgeY, rewWidth, 28, 14);
    ctx.fillStyle = 'rgba(234, 179, 8, 0.3)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(253, 224, 71, 0.6)';
    ctx.stroke();

    ctx.fillStyle = '#fef08a';
    ctx.fillText(rewText, rewX + rewWidth / 2, badgeY + 14);

    // Divider Line
    ctx.beginPath();
    ctx.moveTo(innerX + 40, badgeY + 45);
    ctx.lineTo(innerX + innerW - 40, badgeY + 45);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Emoji Stage (Center Display)
    const emojiY = innerY + 235;
    ctx.font = emojiFont;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
    ctx.shadowBlur = 20;
    ctx.fillText(formattedEmoji, width / 2, emojiY);
    ctx.shadowBlur = 0;

    ctx.restore();

    // Save image to cache
    const cacheDir = path.join(__dirname, '../../cache');
    if (!fs.existsSync(cacheDir)) {
        fs.mkdirSync(cacheDir, { recursive: true });
    }

    const filePath = path.join(cacheDir, `dhbc_${Date.now()}_${Math.random().toString(36).substring(7)}.png`);
    const buffer = canvas.toBuffer('image/png');
    fs.writeFileSync(filePath, buffer);

    return filePath;
}

module.exports = {
    name: "dhbc",
    aliases: ["duoihinhbatchu"],
    description: "Game Đuổi Hình Bắt Chữ phiên bản Canvas siêu đẹp",
    commandCategory: "Minigame",
    usages: "gõ [prefix]dhbc để chơi",
    cooldowns: 5,

    execute: async ({ api, event, args, Currencies, Users, config }) => {
        const { threadID, senderID } = event;
        const key = String(threadID);

        const cooldownCheck = checkCooldown(senderID, "dhbc", 5);
        if (!cooldownCheck.allowed) {
            return api.sendMessage(`⏱️ Bạn thao tác quá nhanh! Vui lòng đợi ${cooldownCheck.timeLeft}s nữa.`, threadID, event.messageID);
        }

        if (global.duoiHinhBatChuSessions[key]) {
            return api.sendMessage(
                `⚠️ Nhóm bạn đang có một câu hỏi Đuổi Hình Bắt Chữ chưa giải!\n` +
                `👉 Reply tin nhắn câu đố kèm đáp án, nhập "gợi ý" để lấy gợi ý hoặc nhập "đáp án" để kết thúc.`,
                threadID,
                event.messageID
            );
        }

        const puzzle = puzzles[Math.floor(Math.random() * puzzles.length)];
        const reward = 500 + Math.floor(Math.random() * 501);

        const wordCount = puzzle.answer.trim().split(/\s+/).length;
        const charCount = puzzle.answer.replace(/\s+/g, "").length;

        const messageText = 
            `🧩 ĐUỔI HÌNH BẮT CHỮ 🧩\n` +
            `📂 Chủ đề: ${puzzle.category || "Đố vui"}\n` +
            `🔤 Gợi ý độ dài: ${wordCount} từ (${charCount} ký tự)\n` +
            `💰 Thưởng: +${reward} xu\n` +
            `⏱️ Thời gian: 5 phút\n` +
            `━━━━━━━━━━━━━\n` +
            `👉 Reply tin nhắn này kèm đáp án!\n` +
            `💡 Nhập "gợi ý" nếu bí  |  ❌ Nhập "đáp án" để bỏ qua`;

        let imagePath = null;
        try {
            imagePath = await generateDHBCImage({
                emoji: puzzle.emoji,
                category: puzzle.category || "Đố vui",
                reward
            });
        } catch (err) {
            console.error("Lỗi tạo ảnh Canvas ĐHBC:", err);
        }

        const sendMsgObj = { body: messageText };
        if (imagePath && fs.existsSync(imagePath)) {
            sendMsgObj.attachment = fs.createReadStream(imagePath);
        }

        // Tạo timer tự động hủy sau 5 phút (300,000ms) nếu không ai trả lời
        const timeout = setTimeout(() => {
            const currentSession = global.duoiHinhBatChuSessions[key];
            if (currentSession) {
                delete global.duoiHinhBatChuSessions[key];
                api.sendMessage(
                    `⏰ ĐÃ HẾT THỜI GIAN (5 PHÚT)!\n` +
                    `❌ Đã quá 5 phút không có câu trả lời. Đợt chơi bị HỦY và đáp án sẽ KHÔNG ĐƯỢC TIẾT LỘ! Muhahaha! 😈`,
                    key
                );
            }
        }, 5 * 60 * 1000);

        global.duoiHinhBatChuSessions[key] = {
            messageID: null,
            puzzle,
            hintIndex: 0,
            reward,
            accepted: buildAcceptedList(puzzle),
            timeout
        };

        try {
            const info = await api.sendMessage(sendMsgObj, key);
            if (info && info.messageID) {
                global.duoiHinhBatChuSessions[key].messageID = info.messageID;
            }
        } catch (err) {
            console.error("Lỗi gửi tin nhắn ĐHBC:", err);
        }

        // Tự động xóa file temp sau khi gửi
        if (imagePath && fs.existsSync(imagePath)) {
            setTimeout(() => {
                if (fs.existsSync(imagePath)) {
                    fs.unlink(imagePath, () => {});
                }
            }, 60000);
        }
    },

    handleReply: async ({ api, event, Currencies, Users }) => {
        const { threadID, body, messageReply, senderID } = event;
        const key = String(threadID);
        const session = global.duoiHinhBatChuSessions[key];

        if (!session) return;
        if (!messageReply) return;

        const isSessionReply =
            (session.messageID && String(messageReply.messageID) === String(session.messageID)) ||
            (messageReply.body && (
                messageReply.body.includes("Reply tin nhắn này kèm đáp án") ||
                messageReply.body.includes("ĐUỔI HÌNH BẮT CHỮ")
            ));

        if (!isSessionReply) return;

        const rawLower = (body || "").trim().toLowerCase();
        const normalized = normalizeAnswer(body);

        // Trường hợp xin gợi ý
        if (
            normalized === "goiy" || 
            normalized === "hint" || 
            normalized === "xemgoiy" || 
            normalized === "xingoiy" ||
            rawLower.includes("gợi ý") ||
            rawLower.includes("goi y")
        ) {
            const hint = session.puzzle.hints?.[session.hintIndex];
            if (!hint) return api.sendMessage("💡 Đã hết gợi ý cho câu hỏi này!", threadID);

            session.hintIndex += 1;
            // Trừ 100 xu tiền thưởng khi lấy gợi ý (tối thiểu 200 xu)
            session.reward = Math.max(200, session.reward - 100);

            return api.sendMessage(
                `💡 GỢI Ý (${session.hintIndex}/${session.puzzle.hints.length}): ${hint}\n` +
                `💰 Tiền thưởng hiện tại: ${session.reward} xu`,
                threadID
            );
        }

        // Trường hợp đầu hàng xem đáp án
        if (
            normalized === "dapan" || 
            normalized === "dap" || 
            normalized === "end" || 
            normalized === "stop" || 
            normalized === "boqua" ||
            normalized === "xemdapan" ||
            normalized.includes("dapan") ||
            rawLower.includes("đáp án") ||
            rawLower.includes("dap an")
        ) {
            const answer = session.puzzle.answer;
            if (session.timeout) clearTimeout(session.timeout);
            delete global.duoiHinhBatChuSessions[key];
            return api.sendMessage(`❌ CÂU ĐỐ ĐÃ KẾT THÚC!\nĐáp án chính xác là: 🌟 ${answer} 🌟`, threadID);
        }

        // Trường hợp trả lời đúng
        if (session.accepted.includes(normalized)) {
            const answer = session.puzzle.answer;
            const rewardCoins = session.reward || 500;
            if (session.timeout) clearTimeout(session.timeout);
            delete global.duoiHinhBatChuSessions[key];

            let userName = "Bạn";
            try {
                if (Users && typeof Users.getNameUser === 'function') {
                    userName = await Users.getNameUser(senderID);
                }
            } catch (e) {}

            if (Currencies && typeof Currencies.increaseMoney === 'function') {
                try {
                    await Currencies.increaseMoney(senderID, rewardCoins);
                } catch (e) {
                    console.error("Lỗi cộng xu ĐHBC:", e);
                }
            }

            return api.sendMessage(
                `🎉 CHÍNH XÁC!\n` +
                `👏 Chúc mừng ${userName} đã trả lời đúng đáp án: ✨ ${answer} ✨\n` +
                `💰 Bạn nhận được: +${rewardCoins} xu thưởng!`,
                threadID
            );
        }

        return api.sendMessage("❌ Đáp án chưa chính xác, hãy thử lại xem sao!", threadID);
    }
};
