양보 시작 (Give Way)	“Stay on your current lane to give way to the emergency vehicle. Decelerate to stay behind the <OBJECT>.”→ 변형들: “Stay on your current lane to let the vehicle through.” / “Allow passage for the other vehicle.” / “Give priority to the vehicle ahead.”	교차로나 마주침 시 상대에게 우선권을 부여하는 reasoning	
기다림 (Gap Waiting)	“Wait for a gap in the traffic before changing lanes.”→ “Hold your position until there’s a gap.” / “Wait for a safe gap in the traffic before proceeding.”	안전한 공간 확보 전까지 멈춤 상태 유지	
통과 판단 (Proceed after Yield)	“Go around the <OBJECT>. Wait for a gap in the traffic before changing lanes to the lane with oncoming traffic.”	상대 차량 통과 후 재진입 또는 진행 판단	
교차로 대응 (Junction)	“Turn right. Cut your speed because the other vehicles are stopped at the junction and the junction is clear.”	교차로 내 상황 평가 및 진입 전 감속	
협상형 Reasoning (Negotiation / Hold Position)	“Hold your position until there’s a safe space before moving.” / “Pause until a gap appears in the traffic before moving over.”	상호 인식 기반 의사결정 표현, “가위바위보형 양보”에 적합	
			
			
질문 (Question)	가능한 답변 후보	의미 / UI 적용	
Q: “Which vehicles should the ego car watch when turning left at the intersection?”	A1: “The ego vehicle should pay particular attention to traffic coming from the left side of the intersection and is going straight or turning left, traffic coming from the right and going straight or turning left, and to oncoming traffic.”	교차로 좌회전 시 시야 인지 정보 (탑승자에게 ‘왜 기다리는가’를 설명 가능)	
Q: “From which side are other vehicles allowed to change lanes into the ego lane?”	A1: “There are no lane changes possible since the ego vehicle is on a one-lane road.”A2: “Vehicles parked on the right side are allowed to enter the ego lane.”	일방통행·좁은 차선에서의 협상형 판단 상황	
Q: “Why did the ego car slow down before entering the junction?”	A1: “Because there was oncoming traffic going straight, and the car decided to yield.” 	‘가위바위보’ 상황의 판단 이유 설명에 직접 사용 가능	
Q: “What is the ego vehicle waiting for?”	A1: “A safe gap in traffic before proceeding.” / A2: “Other vehicles to clear the junction.”	대기 상태의 명시적 reasoning → 인터페이스에 “안전 간격 대기 중” 표시 가능	
			
			
			
시나리오 유형	사용 Commentary	관련 VQA	표시할 reasoning 포인트
비보호 좌회전	“Wait for a gap in the traffic before proceeding.” / “Give way to oncoming traffic.”	“Which vehicles should the ego watch when turning left?”	상대 차량 인식 및 양보 판단 시각화
회전 교차로 진입	“Stay on your current lane to allow passage for other vehicles.” / “Hold position until safe.”	“What is the ego vehicle waiting for?”	진입 타이밍 결정 및 대기 이유 표시
일방통행/마주침 상황	“Hold your position until the road is clear.” / “Wait for a safe gap before moving.”	“From which side are other vehicles allowed to enter the ego lane?”	협상 대기 상태 (우선권 판단) 피드백
긴급차량 양보	“Give way to the emergency vehicle. Wait for a gap in the traffic before changing lanes.”	“What is the ego car doing?” → “Waiting to allow emergency vehicle to pass.”	사회적 판단(공공성) 강조 가능