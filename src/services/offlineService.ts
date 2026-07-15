// src/services/offlineService.ts
import { DisasterAnalysis, ChatMessage, DisasterType } from "../types";
import { initLlama } from 'llama-cpp-capacitor';

// 1. 本地專家規則庫 (原 getOfflineAnalysis 同步版，重命名為 getLocalKnowledge 作為備用知識庫)
function getLocalKnowledge(userInput: string, conversationText: string = userInput): DisasterAnalysis {
  let advice = "目前離線。請描述您的狀況（例如：地震、失火、受困）。";
  let options: string[] = [];
  let riskLevel = 8;

  // 1. 地震主選單
  if (userInput.includes("地震")) {
    advice = "地震發生：1. 請執行『趴下、掩護、穩住』。2. 請回報您的現況：";
    options = ["受困", "出口受阻", "受傷", "我人安全", "有瓦斯味"];
  } 
  // 2. 我人安全分支
  else if (userInput === "我人安全") {
    advice = "請保持冷靜。請問您目前身處？";
    options = ["低樓層 (1-3樓)", "中高樓層 (4樓以上)"];
    riskLevel = 5;
  }
  else if (userInput.includes("低樓層")) {
    advice = "【低樓層】搖晃停止後走樓梯撤離至室外。離開前關閉瓦斯與電源，注意掉落物。";
    options = ["已撤離至室外", "樓梯/出口受阻", "撤離途中受傷"];
  }
  else if (userInput.includes("中高樓層")) {
    advice = "【高樓層】切勿搭電梯！若結構無損請留在室內核心柱旁。撤離時走樓梯，若因受傷無法移動，請選擇下方選項。。";
    options = ["準備撤離，樓梯暢通", "受傷了無法撤離"];
  }

  // 3. 受困分支 (包含 建築/水/火)
  else if (userInput === "受困" || userInput.includes("困住")) {
    advice = "您已受困。請選擇受困環境，以便提供脫困指引：";
    options = ["受困：建築倒塌", "受困：水災", "受困：火就在我旁邊"];
    riskLevel = 9;
  }
  else if (userInput === "受困：建築倒塌") {
    advice = "【受困：建築倒塌】保護頭部與口鼻。規律敲擊管線發訊，不要大聲喊叫。節省體力，等待搜救。";
    options = ["有呼吸困難", "有嚴重受傷", "目前無傷但不知如何應變", "回首頁"];
  }
  else if (userInput === "受困：水災") {
    advice = "【受困：水災】設法爬往高處（如家具上方或二樓以上）。遠離插座以防觸電。準備手電筒或鮮豔衣物求救。若水持續上漲，尋找大型漂浮物。";
    options = ["水面持續上升", "水面漸緩或停滯", "回首頁"];
  }
  else if (userInput === "受困：火就在我旁邊") {
    advice = "【受困：火災】火源若在同一空間，請立刻趴下！貼緊地面 30 公分內尋找殘存氧氣。用衣物掩住口鼻，迅速爬向離火源最遠的窗戶或陽台。絕對不可以躲在床底、浴室或衣櫃裡！";
    options = ["發現窗戶或陽台", "身上衣物著火", "被火包圍無法移動", "退到其他無火房間"];
  }

  // 4. 出口受阻分支 (包含 建築/水/火)
  else if (userInput.includes("出口受阻")) {
    advice = "目前人身安全但無法離開。請告知阻礙類型，協助您尋找替代方案：";
    options = ["出口：建築倒塌", "出口：水災", "出口：門外有火災"];
    riskLevel = 7;
  }
  else if (userInput === "出口：建築倒塌") {
    advice = "【出口受阻：倒塌】檢查是否有其他窗戶或通風口可離開。嘗試輕撥瓦礫，但若感覺結構搖晃請立即停止並後退。";
    options = ["發現其他出口", "沒有其他出口", "回首頁"];
  }
  else if (userInput === "出口：水災") {
    advice = "【出口受阻：水災】切勿強行涉水離開（尤其超過膝蓋高度）。移動至高樓層待援，準備手電筒。若有大量水灌入，請選擇方案。";
    options = ["已往高層移動", "水面持續上升", "水面漸緩或停滯","回首頁"];
  }
  else if (userInput === "出口：門外有火災") {
    advice = "【出口受阻：火災】不要開門！確認門把溫度。尋找另一個無煙的防火區劃（關門避難）。";
    options = ["門把發燙", "煙霧進入室內", "回首頁"];
  }

  // 5. 受傷與回首頁處理
  // 5-1. 受傷主選單
  else if (userInput === "受傷" || userInput === "撤離途中受傷") {
    advice = "【受傷處置】保持冷靜，深呼吸。現在哪裡受傷了？請點選對應狀況：";
    options = ["大量出血", "骨折或脫臼", "壓傷砸傷", "頭頸部受傷", "燒燙傷/吸入傷", "焦慮過度"];
    riskLevel = 8;
  }

  // 5-2. 各個傷勢的自救處置
  else if (userInput === "大量出血") {
    advice = "【止血動作】1. 找乾淨布料緊壓傷口。 2. 若血滲出來，不要撕掉舊布，直接疊加新布繼續壓。 3. 把受傷部位抬高，超過心臟位置。 4. 若還是止不住，在傷口靠近心臟端用皮帶或布條勒緊（記住現在時間）。";
    options = ["已嘗試止血", "回首頁"];
    riskLevel = 10;
  }
  else if (userInput === "骨折或脫臼") {
    advice = "【骨折固定】1. 絕對不要自己嘗試把骨頭推回去。 2. 找木板、雨傘或硬紙板當支撐。 3. 固定我受傷部位的上下兩個關節。 4. 觀察我的指甲顏色，如果是紫色代表太緊，要放鬆一點。";
    options = ["已完成固定", "回首頁"];
  }
  else if (userInput === "壓傷砸傷") {
    advice = "【壓傷應變】1. 如果重物壓著已經超過 15 分鐘，『絕對不要』強行推開重物（避免毒素回流心臟）。 2. 如果剛發生，儘快搬開重物並檢查肢體。 3. 如果清醒就多喝水，拿衣服蓋住身體保暖。";
    options = ["重物已移除", "重物無法移除", "回首頁"];
    riskLevel = 9;
  }
  else if (userInput === "頭頸部受傷") {
    advice = "【頸部保護】1. 除非這地方要爆炸或失火，否則絕對不要移動身體。 2. 用捲好的衣服墊在我脖子兩側固定。 3. 感受一下：我會不會想吐？手腳會不會麻？如果是，我必須保持完全靜止待援。";
    options = ["感覺意識模糊", "回首頁"];
    riskLevel = 10;
  }
  else if (userInput === "燒燙傷/吸入傷") {
    advice = "【燒傷處置】1. 沖、脫、泡、蓋。如果衣服黏在皮膚上，千萬不能撕它。 【吸入傷處置】2. 如果覺得聲音變啞、口鼻有黑灰，呼吸道可能腫起。盡量要坐正，解開領口，專心呼吸，不要躺下。";
    options = ["衣物黏在皮膚上", "傷口出現水泡", "環境仍有火煙", "呼吸越來越難", "回首頁"];
    riskLevel = 10;
  }
  else if (userInput === "焦慮過度") {
    advice = "【心理安定】現在很安全。請一起做：1. 吸氣 4 秒、憋氣 2 秒、吐氣 6 秒。 2. 看看四周，找出 5 個我看到的物品、聽 3 個聲音。 3. 對自己說：『我正在等待救援，我會沒事的。』";
    options = ["情緒稍微平穩", "回首頁"];
    riskLevel = 4;
  }

  // 5-3. 延伸狀況 
  else if (userInput === "重物無法移除") {
    advice = "【原地待援】請停止亂挖，避免再次塌陷。每隔一段時間敲擊物品發出聲音。記得保持體溫，蓋上身邊能蓋的衣服。";
    options = ["有呼吸困難", "有嚴重受傷", "回首頁"];
  }
  else if (userInput === "感覺意識模糊") {
    advice = "【緊急處置】如果覺得快暈倒了，想辦法讓自己側躺（復甦姿勢），避免嘔吐物塞住呼吸道。如果還有力氣，把手機設為警報模式或吹哨子。";
    options = ["已採復甦姿勢", "回首頁"];
    riskLevel = 10;
  }
  // 燒傷/吸入傷
  else if (userInput === "衣物黏在皮膚上") {
    advice = "【衣物處置】1. 嚴禁強行撕開黏住的衣物，以免造成皮膚撕脫傷。 2. 剪開周圍沒黏住的衣物。 3. 讓黏住的部位跟著身體一起沖冷水降溫。";
    options = ["已完成降溫", "回首頁"];
  }

  else if (userInput === "傷口出現水泡") {
    advice = "【水泡處置】1. 嚴禁刺破水泡，以免引發嚴重感染。 2. 使用乾淨的保鮮膜或不沾黏紗布鬆鬆地覆蓋傷口。 3. 不要塗抹牙膏、醬油或任何藥膏。";
    options = ["已覆蓋傷口", "回首頁"];
  }

  else if (userInput === "環境仍有火煙") {
    advice = "【撤離防護】1. 立即離開高溫區域。 2. 若有濃煙，採取低姿勢爬行。 3. 避開門把發燙的房間。 4. 用濕衣物遮蓋未受傷的皮膚。";
    options = ["已撤離至安全處", "回首頁"];
    riskLevel = 10;
  }
  else if (userInput === "呼吸越來越難") {
    advice = "【呼吸道緊急應變】1. 絕對不要躺下！必須保持坐直，或是稍微前傾。 2. 解開所有領口、領帶或緊身衣物。 3. 嘗試用嘴巴深呼吸，不要用鼻子。 4. 不要喝水，避免嗆到。 5. 如果有口哨或能發出聲響的東西，現在就開始規律發訊，避免無法說話。";
    options = ["已保持坐姿", "回首頁"];
    riskLevel = 10; // 最高風險
  }

  else if (userInput === "已保持坐姿") {
    advice = "【持續監控】做得好。保持冷靜，減少身體晃動來節省氧氣。盯著手錶或手機，專心在每一次的呼吸。如果感覺快暈倒，想辦法讓自己靠著牆壁坐穩，不要倒下阻塞氣管。";
    options = ["回首頁"];
    riskLevel = 10;
  }
  else if (userInput === "回首頁") {
    advice = "已回到初始選單。請描述狀況或選擇下方的地震選項：";
    options = ["地震"];
  }

  // 6. 瓦斯味分支
  else if (userInput === "有瓦斯味") {
    advice = "【危險防禦】1. 嚴禁開關任何電器如電燈、打火機、或抽風機！嚴禁拔插頭 2. 順手關閉瓦斯總開關 3. 輕輕「手動」推開窗戶通風 4. 迅速撤離至室外空曠處";
    options = ["已關閉總開關", "無法關閉開關", "回首頁"];
    riskLevel = 10; // 風險等級調至最高
  }
  // 延伸選項：無法關閉開關
  else if (userInput === "無法關閉開關") {
    advice = "【盡速撤離】立即放棄關閉 1. 維持現有電器狀態，直接開門。 2. 用濕毛巾或衣物掩住口鼻。 3. 壓低姿勢走樓梯撤離。";
    options = ["準備好出發撤離", "擔心撤離途中氣爆"];
    riskLevel = 10;
  }

  // 延伸選項：已關閉總開關
  else if (userInput === "已關閉總開關") {
    advice = "【安全撤離】做得好。 1. 維持現有電器狀態 2. 拿好避難包，用衣物護住頭部與口鼻。 3. 走樓梯撤離至戶外空曠處。樓梯間較通風，擴散較快，撤離是唯一安全路徑。";
    options = ["準備好出發撤離", "擔心撤離途中氣爆"];
    riskLevel = 7;
  }

  // 增加擔心撤離途中氣爆的選項
  else if (userInput === "擔心撤離途中氣爆") {
    advice = "【心理建設】留在高濃度瓦斯室內遭遇氣爆與窒息的機率是 100%。大樓樓梯間多有通風設計，濃度較低。 1. 撤離時用厚外套、防護墊或雙臂護住頭部與胸口。 2. 採取微蹲低姿勢。 3. 不要猶豫，迅速走樓梯向下，安全在於速度！";
    options = ["準備好出發撤離", "回首頁"];
    riskLevel = 9;
  }
  else if (userInput === "準備好出發撤離") {
    advice = "【行動指令】保持冷靜，用衣物遮住口鼻，手護住頭部，立刻出發走樓梯下樓！";
    options = ["回首頁"];
  }

  // 7. 深度延伸指令 (第一層)

  // 高樓層延伸
  else if (userInput === "準備撤離，樓梯暢通") {
    advice = "【撤離提醒】請攜帶緊急避難包，沿樓梯右側向下行進，將左側留給搜救人員。抵達一樓後，迅速移動至最近的開放綠地或避難收容所。";
    options = ["已撤離至室外", "回首頁"];
  }
  else if (userInput === "受傷了無法撤離") {
    advice = "【高樓層就地避難】1. 停止撤離，留在原地，移動至安全角落。 2. 優先處理大出血，利用衣物加壓止血並保暖。 3. 在窗戶懸掛亮色衣物或用硬物敲擊發出規律聲響，讓搜救人員知道您的位置。4. 保持手機電力，每小時開啟一次發訊。";
    options = ["受傷", "回首頁"]; 
    riskLevel = 9;
  }

  // 受困：建築倒塌延伸
  else if (userInput === "有呼吸困難") {
    advice = "【呼吸防護】1. 停止所有移動與喊叫，立刻趴下或靠牆坐好。2. 用衣物遮住口鼻，若附近有水，打濕衣物效果更好。3. 閉上眼睛，用肚子緩慢深呼吸，切勿驚慌。";
    options = ["這種狀態要過多久？", "身邊沒有水怎麼辦？", "身上沒有多餘衣物怎麼辦？", "回首頁"];
    riskLevel = 10;
  }
  else if (userInput === "有嚴重受傷") {
    advice = "【緊急自救】若有大出血，利用衣物或皮帶在傷口上方進心端施加壓力。骨折處請勿移動，找尋身邊硬物（如長木板、結實硬紙板）簡單固定。保持體溫，防止休克。";
    options = ["已嘗試止血", "回首頁"];
    riskLevel = 10;
  }
  else if (userInput === "目前無傷但不知如何應變") {
    advice = "【受困指南】1. 穩定情緒：確認目前人身安全，深呼吸。 2. 評估空間：觀察上方結構是否穩定，切勿強行推擠重物，避免引發二次塌陷。 3. 保存體力：靜臥或靠牆坐好，收攏四肢維持體溫。 4. 定時發訊：每隔幾分鐘規律敲擊（如敲三聲），聽到外面有搜救聲時再吹哨或呼救。";
    options = ["已採就地待援姿勢", "回首頁"];
    riskLevel = 8;
  }

  // 受困：水災延伸
  else if (userInput === "水面持續上升") {
    advice = "【水災危險】拋棄沉重衣物。將自己繫在大型漂浮物（如床墊、大型塑膠箱）上。若在室內且水面逼近天花板，尋找是否有通往屋頂的出口或對外窗。";
    options = ["怎麼把漂浮物繫在身上？", "身邊無大型漂浮物", "屋頂沒有出口", "已往高層移動", "回首頁"];
    riskLevel = 10;
  }
  else if (userInput === "水面漸緩或停滯") {
    advice = "【原地待援】水勢雖緩，但嚴禁涉水離開！積水極可能漏電，且水底常有銳器或掀開的人孔蓋。請堅守目前的高處，保存體力，並利用手電筒（夜間）或懸掛鮮豔衣物（白天）向外發出求救信號。";
    options = ["已建立求救信號", "回首頁"];
    riskLevel = 10;
  }

  // 受困：火災延伸
  else if (userInput === "發現窗戶或陽台") {
    advice = "【對外求生】迅速爬至窗邊或陽台。若是高樓層，請靠在窗邊呼吸新鮮空氣，大聲呼救並揮舞明顯衣物，讓消防員能第一時間看到您，切勿盲目跳樓！若是低樓層且窗外安全，才可考慮攀爬逃生。";
    options = ["火場濃煙呼吸困難", "正在等待救援", "回首頁"];
    riskLevel = 10;
  }
  else if (userInput === "身上衣物著火") {
    advice = "【停、趴、滾】不要慌張奔跑，風會讓火變大！1. 停：立刻停在原地。2. 趴：馬上雙手掩住臉部趴在地上。3. 滾：左右來回翻滾，直到火勢撲滅。嚴禁用手拍打火勢。4. 若解決且無大礙，請確認目前處境。";
    options = ["衣物黏在皮膚上", "傷口出現水泡", "回首頁"];
    riskLevel = 10;
  }
  else if (userInput === "被火包圍無法移動") {
    advice = "【最後防護】若無路可退，請趴在離火最遠的角落。用厚重衣物或棉被（若能弄濕更好）將自己全身覆蓋。務必將臉部朝下貼緊地面，專注於淺層呼吸，等待消防隊射水救援。";
    options = ["火場濃煙呼吸困難", "焦慮過度", "回首頁"];
    riskLevel = 10;
  }
  else if (userInput === "退到其他無火房間") {
    advice = "【防線建立】立刻關上這扇門，把火擋在外面！尋找毛巾或衣物塞住門縫，並移往有對外窗的位置求救。";
    options = ["門把發燙", "煙霧進入室內", "回首頁"];
    riskLevel = 10;
  }

  // 出口受阻：建築倒塌延伸
  else if (userInput === "發現其他出口") {
    advice = "【謹慎移動】緩慢向出口移動，注意頭部上方瓦礫是否鬆動。每移動一段距離請停下聽有無異常聲響。若出口狹窄，確保身體能通過再前進，避免再次受困。";
    options = ["已安全離開", "回首頁"];
  }
  else if (userInput === "沒有其他出口") {
    advice = "【就地避難待援】1. 停止嘗試挖掘，避免造成二次崩塌。 2. 尋找室內堅固家具旁（如鋼製桌下）避難，保護頭部。 3. 利用口哨或硬物敲擊牆壁/水管（規律三聲），避免大聲喊叫耗費氧氣。 4. 若有窗戶，懸掛亮色衣物標示位置。";
    options = ["已建立求救信號", "回首頁"];
    riskLevel = 9; // 風險等級提升，因為這已經接近受困狀態
  }

  // 延伸確認：已建立求救信號
  else if (userInput === "已建立求救信號") {
    advice = "【保存體力】做得好。現在請保持冷靜，深呼吸穩定情緒。每隔一段時間再次敲擊信號。若手機還有電力，將其設為省電模式，並每小時檢查一次訊息。";
    options = ["回首頁"];
  }
  // 出口受阻：水災延伸
  else if (userInput === "已往高層移動") {
    advice = "【高處待援】確認手機訊號與電量。若夜間請規律閃爍手電筒發出 SOS 訊號。切勿因水面暫時退去就嘗試下樓，等待官方確認安全。";
    options = ["發出訊號中", "回首頁"];
  }

  // 出口受阻：火災延伸
  else if (userInput === "門把發燙") {
    advice = "【嚴禁開門】這代表門外已有劇烈火煙！立即關閉所有內部門窗減緩火勢蔓延。退往離火源最遠且有對外窗的房間，用衣物塞住所有門縫，等待消防隊。";
    options = ["已進入避難房間", "回首頁"];
    riskLevel = 10;
  }
  else if (userInput === "煙霧進入室內") {
    advice = "【防煙應變】立即採取低姿勢（地表 30 公分內仍有剩餘新鮮空氣）。尋找毛巾或衣物（若有水弄濕更好）徹底塞住所有門縫。若有對外窗，稍微打開窗戶縫隙呼吸，並向外揮舞明顯色彩衣物。絕對不要躲在浴室！";
    options = ["已採低姿勢", "火場濃煙呼吸困難", "回首頁"];
    riskLevel = 10;
  }

  // 安全確認
  else if (userInput === "已撤離至室外") {
    advice = "【室外避難】做得好！請前往空曠處（如公園、學校操場），遠離高大建築物、外牆磁磚、圍牆及電線桿。持續注意餘震，並嘗試與家人報平安。";
    options = ["回首頁"];
    riskLevel = 2; // 安全撤離，大幅降低風險
  }

  // 8. 深度延伸指令 (第二層)
  else if (userInput === "怎麼把漂浮物繫在身上？") {
    advice = "【固定漂浮物】利用皮帶、背包帶或撕開的長條衣物。將繩索穿過漂浮物穩固處，綁在自己的『腋下與胸部』之間。絕對不要綁在腰部（會導致頭下腳上）或脖子（會勒窒息），確保頭部能時刻浮出水面。";
    options = ["已完成固定", "回首頁"];
    riskLevel = 10;
  }
  else if (userInput === "身邊無大型漂浮物") {
    advice = "【替代漂浮物】尋找空寶特瓶（務必旋緊瓶蓋）、密封的塑膠袋、保鮮盒 or 防潑水背包。將這些充滿空氣的物品塞進外套內部或衣服內，拉上拉鍊或將下擺紮進褲子裡，這能為身體提供重要的臨時浮力。";
    options = ["已製作臨時浮力衣", "回首頁"];
    riskLevel = 10;
  }
  else if (userInput === "屋頂沒有出口") {
    advice = "【防溺應變】絕對不要逃進沒有逃生口的密閉閣樓！ 若水面逼近天花板，立刻尋找對外窗戶，用重物（如椅子、滅火器）擊碎窗戶四角逃生。若無法破窗，請盡可能抬高下巴，讓口鼻貼近天花板剩下的最後空氣層，規律敲擊天花板或牆壁求救。";
    options = ["已破窗或找到空氣層", "水災導致呼吸困難", "回首頁"];
    riskLevel = 10;
  }
  else if (userInput === "水災導致呼吸困難") {
    advice = "【極限求生】1. 盡量仰起頭部，讓口鼻完全貼緊天花板或最高處剩餘的空氣層。 2. 絕對不要驚慌大口喘氣，改用『緩慢且淺』的呼吸節省氧氣，避免吸入水分。 3. 雙手輕輕撥水維持平衡，保留體力。 4. 用硬物規律敲擊天花板發出求救訊號。";
    options = ["正在執行求生操作", "回首頁"];
    riskLevel = 10;
  }
  else if (userInput === "火場濃煙呼吸困難") {
    advice = "【火場防煙極限】1. 絕對不能站立或坐直！立刻將身體完全趴平，口鼻貼緊地面（30 公分內有剩餘氧氣）。 2. 將衣物多層摺疊（若有水弄濕更好）緊緊摀住口鼻，過濾致命碳微粒。 3. 採取「淺而短」的呼吸，千萬不要大口吸氣。 4. 沿著牆壁邊緣爬向有對外窗的位置爭取新鮮空氣。";
    options = ["正在執行求生操作", "回首頁"];
    riskLevel = 10;
  }
  else if (userInput === "這種狀態要過多久？") {
    advice = "【保持狀態】1. 首先保持 72 小時，搜救隊已經在路上。 2. 人體在無水無食物、僅有微弱空氣下，靠著意志力與靜止不動，曾有撐過 5 至 7 天的生存案例。 3. 現在唯一的任務是『節省耗氧量』，每多活一秒，獲救機率就越高。";
    options = ["如何進一步降低耗氧？", "回首頁"];
    riskLevel = 10;
  }
  else if (userInput === "身邊沒有水怎麼辦？") {
    advice = "【無水防護】1. 嚴禁為了找水而挖掘或移動，那會吸入更多粉塵。 2. 緊閉嘴巴，完全改用鼻子呼吸，減少口腔水分蒸發。 3. 若口腔極度乾燥，嘗試吞嚥口水，或將舌頭抵住上顎刺激唾液分泌。 4. 嚴禁飲用自己的尿液（會加速身體脫水與腎衰竭）。";
    options = ["回首頁"];
    riskLevel = 10;
  }
  else if (userInput === "身上沒有多餘衣物怎麼辦？") {
    advice = "【替代防護】1. 直接拉起目前穿著的衣領、袖口，甚至內衣覆蓋口鼻。 2. 若雙手被困無法拉衣物，將臉部直接埋入自己的胸口、腋下或大腿內側的衣物空隙中，利用現有布料形成過濾屏障。 3. 絕對不要裸露口鼻直接呼吸充滿粉塵的空氣。";
    options = ["回首頁"];
    riskLevel = 10;
  }
  else if (userInput === "回首頁") {
    advice = "已回到初始選單。請描述狀況或選擇下方的選項：";
    options = ["地震"];
  }

  return {
    type: DisasterType.EARTHQUAKE,
    riskLevel,
    situationSummary: `[離線模式自動回覆] ${userInput}`,
    immediateActions: [
      { 
        title: "避難指引動作", 
        description: advice, 
        priority: riskLevel > 8 ? "CRITICAL" : "HIGH"
      }
    ],
    survivalProbability: riskLevel > 8 ? 50 : 90,
    longTermAdvice: "請保持手機電力，離線模式將優先引導生存動作。",
    missingInfoRequests: options,
    emergencySummary: buildOfflineEmergencySummary(conversationText, riskLevel),
  };
}

// 2. 離線對話上下文摘要分析器 (來自 main，配合 getLocalKnowledge 使用)
function buildOfflineEmergencySummary(
  conversationText: string,
  riskLevel: number,
): DisasterAnalysis["emergencySummary"] {
  const text = conversationText.replace(/\s+/g, " ");
  const injuryTerms = [
    "受傷", "出血", "骨折", "脫臼", "壓傷", "砸傷", "燒傷", "燙傷",
    "呼吸困難", "意識模糊", "焦慮",
  ];
  const matchedInjuries = injuryTerms.filter((term) => text.includes(term));
  const isTrapped = ["受困", "困住", "無法離開", "出口受阻", "沒有其他出口"]
    .some((term) => text.includes(term));
  const immobile = ["無法撤離", "無法移動", "重物無法移除"]
    .some((term) => text.includes(term));
  const rescueNeeds: string[] = [];
  if (isTrapped) rescueNeeds.push("搜救與脫困");
  if (text.includes("出血")) rescueNeeds.push("止血與緊急醫療");
  if (["骨折", "脫臼", "無法移動", "無法撤離"].some((term) => text.includes(term))) {
    rescueNeeds.push("擔架與後送");
  }
  if (["呼吸困難", "呼吸越來越難", "吸入傷"].some((term) => text.includes(term))) {
    rescueNeeds.push("呼吸道與緊急醫療支援");
  }

  const severe = riskLevel >= 9 || rescueNeeds.length > 0;
  return {
    hasInjuries: matchedInjuries.length > 0,
    injurySummary: matchedInjuries.length
      ? `離線對話已回報：${[...new Set(matchedInjuries)].join("、")}`
      : "",
    injurySeverity: matchedInjuries.length
      ? severe ? "severe" : "moderate"
      : "unknown",
    rescueNeeds: [...new Set(rescueNeeds)],
    isTrapped,
    mobilityStatus: immobile ? "immobile" : "unknown",
    locationDetails: "",
    urgencyLevel: Math.max(1, Math.min(10, riskLevel)),
    confidence: matchedInjuries.length || isTrapped ? 0.7 : 0.2,
  };
}

// 3. 混合架構：導出給 UI 使用的全新非同步大模型函式 (來自 HEAD)
export async function getOfflineAnalysis(messages: ChatMessage[]): Promise<DisasterAnalysis> {
  const lastUserMessage = [...messages].reverse().find(m => m.role === "user")?.content || "";
  
  // 串接對話歷史記錄，讓摘要產生器有足夠的上下文做分析
  const conversationText = messages.map(m => m.content).join(" ");
  const localKnowledge = getLocalKnowledge(lastUserMessage, conversationText);
  const expertAdvice = localKnowledge.immediateActions[0]?.description || "";
  let expertOptions = localKnowledge.missingInfoRequests || [];
  let expertRiskLevel = localKnowledge.riskLevel;

  // 🔥 核心：判斷是不是「沒有命中任何 if/else 規則」，掉到了預設值？
  const isFallbackRule = expertAdvice.includes("目前離線。請描述您的狀況");

  let systemPrompt = "";

  if (isFallbackRule) {
    // 💡 路線 A：自由輸入文字 (LLM 自己想辦法)
    systemPrompt = `你是一個專業的災害應變專家。使用者目前遇到以下緊急狀況：
【使用者狀況】：${lastUserMessage}

請根據此狀況，給出 2 到 3 個最緊急的自救步驟。
絕對不要輸出任何解釋文字、問候語或 Markdown 標記，只能輸出純 JSON 格式。

請完全依照以下格式輸出（必須包含大括號）：
{
  "type": "推斷災害類型(如火災、地震)",
  "riskLevel": 9,
  "situationSummary": "用一句話總結現況",
  "immediateActions": [
    { "title": "步驟一標題", "description": "具體行動1", "priority": "CRITICAL" },
    { "title": "步驟二標題", "description": "具體行動2", "priority": "HIGH" }
  ],
  "survivalProbability": 50,
  "longTermAdvice": "簡短後續建議"
}`;
    
    // 自由輸入的情況下，預設提供第一層按鈕選項
    expertOptions = ["受困", "出口受阻", "受傷", "我人安全", "有瓦斯味"]; 

  } else {
    // 💡 路線 B：命中按鈕的專家規則 (LLM 只做排版)
    systemPrompt = `你是一個 JSON 轉換器。請將下方的【專家建議】拆解為 2 到 3 個具體步驟。
絕對不要輸出任何解釋文字、問候語或 Markdown 標記，只能輸出純 JSON 格式。

【專家建議】：${expertAdvice}

請完全依照以下格式輸出（必須包含大括號）：
{
  "type": "災害", 
  "riskLevel": ${expertRiskLevel},
  "situationSummary": "用一句話總結現況",
  "immediateActions": [
    { "title": "步驟一標題", "description": "第一個動作", "priority": "CRITICAL" },
    { "title": "步驟二標題", "description": "第二個動作", "priority": "HIGH" }
  ],
  "survivalProbability": 80,
  "longTermAdvice": "請保持冷靜等待救援"
}`;
  }

  try {
    const formattedMessages = [
      { role: "system", content: systemPrompt },
      ...messages.map(msg => ({
        role: msg.role === "user" ? "user" : "assistant",
        content: msg.content
      }))
    ];

    // 1. 載入模型並獲取 LlamaContext 實例
    const llamaContext = await initLlama({ 
      model: "Qwen2.5-0.5B-Instruct-Q4_K_M.gguf" 
    });

    // 2. 執行對話，調用實例上的 completion 方法
    const result = await llamaContext.completion({
      messages: formattedMessages as any,
      temperature: isFallbackRule ? 0.3 : 0.0
    });

    // 取得模型回傳的文字
    let aiText = result.text || (result as any).content || "";

    // 清理字串與解析
    aiText = aiText.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
    const jsonStartIndex = aiText.indexOf('{');
    const jsonEndIndex = aiText.lastIndexOf('}');
    
    if (jsonStartIndex === -1 || jsonEndIndex === -1) {
        throw new Error("模型回覆中完全找不到大括號: " + aiText);
    }

    const cleanJsonString = aiText.substring(jsonStartIndex, jsonEndIndex + 1);
    const parsedData = JSON.parse(cleanJsonString);

    // 強制套用選項，防止 LLM 亂生物件導致 UI 壞掉
    parsedData.missingInfoRequests = expertOptions; 
    
    // 如果是路線 B，強制使用專家的風險等級
    if (!isFallbackRule) {
      parsedData.riskLevel = expertRiskLevel;
      parsedData.survivalProbability = expertRiskLevel > 8 ? 50 : 90;
    } else {
      parsedData.riskLevel = parsedData.riskLevel || 8;
      parsedData.survivalProbability = parsedData.survivalProbability || 50;
    }
    
    parsedData.type = parsedData.type || "其他";
    
    // 注入由專家系統產生的離線對話上下文摘要分析，供 UI 及後台警報使用
    parsedData.emergencySummary = localKnowledge.emergencySummary;

    if (!parsedData.immediateActions || !Array.isArray(parsedData.immediateActions) || parsedData.immediateActions.length === 0) {
      throw new Error("JSON 中缺少 immediateActions 陣列");
    }

    return parsedData as DisasterAnalysis;

  } catch (error) {
    console.error("⚠️ LLM 解析失敗，啟動強化版靜態降級方案", error);
    
    let fallbackActions: any[] = []; 
    
    if (expertAdvice.includes("1.")) {
      const splitByNumbers = expertAdvice.split(/\d\.\s*/).filter(text => text.trim().length > 0);
      const titleMatch = expertAdvice.match(/【(.*?)】/);
      const mainTitle = titleMatch ? titleMatch[1] : "避難動作";
      
      fallbackActions = splitByNumbers.map((stepDesc, index) => {
        const cleanDesc = stepDesc.replace(/【.*?】/, '').trim();
        return {
          title: index === 0 && splitByNumbers.length > 1 ? "狀況確認" : `${mainTitle}步驟`,
          description: cleanDesc || stepDesc,
          priority: (index === 0 ? "CRITICAL" : "HIGH") as "CRITICAL" | "HIGH" 
        };
      }).filter(action => action.description.length > 0);

    } else {
      const splitByPeriods = expertAdvice.split('。').filter(text => text.trim().length > 0);
      fallbackActions = splitByPeriods.map((stepDesc, index) => ({
        title: index === 0 ? "首要應變" : "後續動作",
        description: stepDesc + "。",
        priority: (index === 0 ? "CRITICAL" : "HIGH") as "CRITICAL" | "HIGH" 
      }));
    }

    return {
      type: "緊急應變" as any,
      riskLevel: expertRiskLevel,
      situationSummary: `[離線安全模式] ${lastUserMessage}`,
      immediateActions: fallbackActions.length > 0 ? fallbackActions : [
        {
          title: "避難指引",
          description: expertAdvice,
          priority: "CRITICAL" as "CRITICAL" 
        }
      ],
      survivalProbability: expertRiskLevel > 8 ? 50 : 90,
      longTermAdvice: "目前處於離線狀態，請依照上述步驟確保自身安全。",
      missingInfoRequests: expertOptions,
      emergencySummary: localKnowledge.emergencySummary
    };
  }
}