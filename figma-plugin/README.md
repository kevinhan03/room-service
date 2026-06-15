# dig.everyday Deck Importer

Builder에서 내려받은 `*-figma.json`을 Figma 프레임으로 변환하는 로컬 개발 플러그인입니다.

## 설치

1. Figma에서 `Plugins > Development > Import plugin from manifest...`를 엽니다.
2. 이 폴더의 `manifest.json`을 선택합니다.
3. 플러그인 목록에서 `dig.everyday Deck Importer`를 실행합니다.

## 사용

1. dig.everyday Builder에서 7장 덱을 준비합니다.
2. Export 영역의 `Figma로 내보내기`를 눌러 JSON을 받습니다.
3. JSON 파일 내용을 플러그인의 입력란에 붙여넣고 `Import`를 누릅니다.
4. 생성된 7개 프레임의 `IMAGE PLACEHOLDER` 사각형에 사진을 이미지 Fill로 넣습니다.

플러그인은 외부 네트워크를 사용하지 않으며 JSON에도 원본 이미지 URL을 포함하지 않습니다.
