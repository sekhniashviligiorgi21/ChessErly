<script setup>  
	import { ref, onMounted } from 'vue'  
	import { Chess } from 'chess.js'  
	import { TheChessboard } from 'vue3-chessboard'  
	import 'vue3-chessboard/style.css';  
	import Title from "../assets/Title.vue"  
	const chess = new Chess()   
	const greedychess = new Chess()  
	const excellentchess = new Chess()  
	const bestchess = new Chess()  
	const lastMoveIndex = ref(null)  
	const currentMoveIndex = ref(0)  
	const Movedata = ref(null)  
	const boardAPI = ref(null)   
	const resetBtn = ref(null)  
	let isanalyzing = ref(false)  
	let currentdepth = ref(0)  
	let lastmove = ref('')  
	let moveslist = ref([])  
	let moveslistUCL = ref([])  
	let lastmoveUCL = ref('')  
	let height = ref(47.75)  
	let cp = ref(0)  
	let rotate = ref(0)  
	let moveAccuracies = ref([])  
	let isaccuracy = ref("")  
	let color = ref("")  
	let sanline = ref([])  
	let bestmovesan = ref('')  
	let excellentsanline = ref([])  
	const pageNum = ref(1)
  
	onMounted(()=>{  
		if (resetBtn.value){  
			resetBtn.value.click()  
		}  
	}  
	)  
  
	function handleMove(move) {  
		const sanMove = chess.move({from: move.from, to: move.to, promotion: move.promotion ?? undefined })  
		if (sanMove){  
			lastmove.value = sanMove.san  
		}  
		moveslist.value.push(lastmove.value)  
		lastMoveIndex.value = moveslist.value.length-1  
		currentMoveIndex.value = moveslist.value.length  
	}  
  
	function handleUCL(move){  
		const moveslist_before = [...moveslistUCL.value]  
		console.log(moveslist_before)  
		lastmoveUCL.value = move.promotion ? `${move.from}${move.to}${move.promotion}` : `${move.from}${move.to}`   
		console.log(lastmoveUCL.value)  
		moveslistUCL.value.push(lastmoveUCL.value)   
		isanalyzing.value = true  
		isaccuracy.value = "Analyzing..."  
		color.value = "#aaa"  
	}  
  
	async function handleBothMoves(move){  
		handleMove(move)  
		handleUCL(move)  
		await getAccuracy()  
	}  
  
	function undoMove(){  
		chess.undo()  
		boardAPI.value.setPosition(chess.fen())  
		lastmoveUCL.value = moveslistUCL.value.at(-2)  
		moveslistUCL.value.pop()  
		currentMoveIndex.value = currentMoveIndex.value - 1  
		moveslist.value.pop()  
		lastmove.value = ""  
	}  
  
	function resetBoard() {  
		chess.reset()  
		boardAPI.value.setPosition(chess.fen())  
		moveslistUCL.value = []  
		lastmoveUCL.value = ""  
		currentMoveIndex.value = 0  
		moveslist.value = []  
		lastmove.value = ""  
	}  
  
	async function getAccuracy() {  
		currentdepth.value = 8  
		let maxdepth = 22  
		while (currentdepth.value <= maxdepth){  
			const response=await fetch("http://127.0.0.1:8000/Analyzis", {  
				method: "POST",  
				headers: {"Content-Type": "application/json"},  
				body: JSON.stringify ({  
					moves_list: moveslistUCL.value.slice(0, -1),   
					move: lastmoveUCL.value,  
					depth: currentdepth.value  
				})  
		})  
		Movedata.value = await response.json()  
		moveAccuracies.value[lastMoveIndex.value] = Movedata.value.move_accuracy  
		currentdepth.value += 2  
		isanalyzing.value = false  
		evalsize()  
		movedescribtion()  
		sanbest()  
		ucisecondline()  
		uciline()  
		}  
	}  
  
	function undoAccuracy(){  
		undoMove()  
		getAccuracy()  
	}  
  
	function resetAccuracy(){  
		resetBoard()  
		getAccuracy()  
	}  
  
	function formatEval(evalObj) {  
	  if (!evalObj) return ""  
	  if (evalObj.type === "cp") return (evalObj.value / 100).toFixed(2)  
	  if (evalObj.type === "mate") return `#${evalObj.value}`  
	}  
  
	function evalsize(){
		let evalValue = Movedata.value.eval.value;
		let evalType = Movedata.value.eval.type;
		
		if (evalType === "mate") {
			if (evalValue > 0) {
				// White is getting mated
				cp.value = 1000;
				height.value = 0;
			} else {
				cp.value = -1000;
				height.value = 95.5;
			}
			return;
		}
		

		cp.value = Math.max(-1000, Math.min(1000, evalValue));
		height.value = 47.75 - (cp.value / 1000) * 47.75;
	} 
  
	function flipboard(){  
		boardAPI.value.toggleOrientation()  
		rotate.value += 180  
	}  
  
	function accuracySymbol(acc){  
		if(acc === "brilliant"){  
			return '!!'  
		}  
		if (acc === "best"){  
			return "★"  
			}  
		if(acc === "excellent"){  
			return '+'  
		}  
		if(acc === "good"){  
			return '✔'  
		}  
		if(acc === "inaccuracy"){  
			return '?!'  
		}  
		if(acc === "mistake"){  
			return '?'  
		}  
		if(acc === "blunder"){  
			return '??'  
		}  
		if (acc === "great"){  
			return '!'  
		}  
		if(acc === "book"){  
			return '📖'  
		}  
	}  
  
	function movedescribtion(){  
		isaccuracy.value = ''  
		if (lastmove.value == '')  
		return  
		if (Movedata.value.move_accuracy === "great"){  
			color.value = "darkcyan"  
			isaccuracy.value = moveslist.value.at(-1) + ' is a great move!'   
		}  
		else if(Movedata.value.move_accuracy === "brilliant"){  
			color.value = "lightblue"  
			isaccuracy.value = moveslist.value.at(-1) + ' is a brilliant move!!'   
		}  
		else if(Movedata.value.move_accuracy === "book"){  
			color.value = "#AA8B6C"  
			isaccuracy.value = moveslist.value.at(-1) + ' is a book move'  
		}  
		else if (Movedata.value.move_accuracy === "best"){  
			isaccuracy.value = moveslist.value.at(-1) + ' is the best move'   
			color.value = "#3fa34d"  
		}  
		else if (Movedata.value.move_accuracy === "excellent"){  
			isaccuracy.value = moveslist.value.at(-1) + ' is an excellent move'   
			color.value = "#88B65C"  
		}  
		else if (Movedata.value.move_accuracy === "good"){  
			isaccuracy.value = moveslist.value.at(-1) + ' is a good move'   
			color.value = "darkgreen"  
		}  
		else if (Movedata.value.move_accuracy === "inaccuracy"){  
			isaccuracy.value =  moveslist.value.at(-1) + ' is an inaccuracy'   
			color.value = "#f0c36d"  
		}  
		else if (Movedata.value.move_accuracy === "mistake"){  
			isaccuracy.value = moveslist.value.at(-1) + ' is a mistake'   
			color.value = "#e67e22"  
		}  
		else if (Movedata.value.move_accuracy === "blunder"){  
			isaccuracy.value = moveslist.value.at(-1) + ' is a blunder'   
			color.value = "#e74c3c"  
		}  
	}  
  
	function displaybest(){  
		if (Movedata.value.move_accuracy == "brilliant" ||   
			Movedata.value.move_accuracy == "best" ||   
			Movedata.value.move_accuracy == "great" ||   
			Movedata.value.move_accuracy == "book"||  
			Movedata.value.move_accuracy == "excellent"){  
			return("")  
		}  
		else if(Movedata.value.best_move == ""){  
			return ""  
		}  
		else{  
			return (bestmovesan.value + " was the best")  
		  
		}  
	}  
  
	function uciline(){  
		sanline.value = []  
		let linenum = 0  
		greedychess.load(chess.fen())  
		for (let i = 0; i<5; i++){  
  
			let greedymovebef = Movedata.value.best_line[linenum]  
			if (!greedymovebef) break  
  
			let greedymove = greedychess.move(greedymovebef, { sloppy: true })  
			if (!greedymove) break   
  
			sanline.value.push(greedymove.san)  
			linenum ++  
		}  
	}  
  
	function sanbest(){  
		bestchess.reset()  
		for (const move of Movedata.value.moves_list.slice(0, -1)){  
			bestchess.move(move)  
		}  
  
		let bestmovebef = Movedata.value.best_move  
  
		let bestmove = bestchess.move(bestmovebef, {sloppy: true})  
  
		bestmovesan.value = bestmove.san  
	}  
  
	function ucisecondline(){  
		excellentsanline.value = []  
		let secondlineNum = 0  
		excellentchess.load(chess.fen())  
		for (let i=0; i<5; i++){  
  
			let excellentmovebef = Movedata.value.excellent_line[secondlineNum]  
			if (!excellentmovebef) break  
  
			let excellentmove = excellentchess.move(excellentmovebef, { sloppy: true })  
			if (!excellentmove) break   
  
			excellentsanline.value.push(excellentmove.san)  
			secondlineNum ++  
		}  
	}  
  
  
</script>  
<template>  
	<div class="grid-layout">  
		<Title :page-num="pageNum"/>  
		<div class="board-area">
			<div class="chessboard">  
				<TheChessboard @move="handleBothMoves" @board-created="(api) => (boardAPI = api)" :board-config="{coordinates: true}" />  
				<div class="boardtools">  
					<button class="reverse" @click="flipboard">↳↰</button>  
					<p class="reversetip">Flip Board</p>  
					<button class="undo" @click="undoAccuracy">↶</button>  
					<p class="undotip">Previous Move</p>  
					<button class="reset" @click="resetAccuracy" ref="resetBtn">🗘</button>  
					<p class="resettip">Reset board</p>  
				</div>  
			</div>  
			<div class="evalbar" :style="{rotate: rotate + 'deg'}">  
				<div class="blackeval" :style="{ height: height + '%' }"></div>  
					<p class="evalnum" :style="{rotate: rotate + 'deg'}" >{{ formatEval(Movedata?.eval) }}</p>  
			<div class="whiteeval" :style="{ height: 95.5-height + '%' }"></div>  
			</div> 
		</div> 
		<div>  
				<div class="analyze">  
				<h2 class="analyzis">Analysis</h2>  
				<div v-if="Movedata" class="movedata">  
					<p class="depthnum">depth: {{ currentdepth }}</p>  
					<p class="line">  
						<p class="evalnum2">{{formatEval(Movedata?.eval)}}</p>  
						{{ sanline.join(" ") }}  
					</p>  
					<p class="secondline">{{ excellentsanline.join(" ") }}</p>  
					<p :style="{color: color}" class="accuracydescribtion" >{{ isaccuracy }}</p>  
					<p class="bestmove" v-if="moveslistUCL.length > 0">{{ displaybest() }}</p>  
				</div>  </div>  
		<div class="moves">  
			<h2 class="movehistory">Move history</h2>  
			<ol class="moveslist">  
	  			<template v-for="(move, index) in moveslist" :key="index">  
	    			<li class="list" v-if="index % 2 === 0" :class="{active: index===lastMoveIndex || index+1 === lastMoveIndex}">  
	      				{{ move }}  
	      				<p class="accuracyemojiW" :class="moveAccuracies[index]">  
	      					{{ accuracySymbol(moveAccuracies[index]) }}  
	      				</p>  
	      				<span class="movespan" v-if="moveslist[index + 1]">  
	        				{{ moveslist[index + 1] }}  
	        				<p class="accuracyemojiB" :class="moveAccuracies[index + 1]">  
	        					{{ accuracySymbol(moveAccuracies[index + 1]) }}  
	        				</p>  
	        			</span>  
	    			</li>  
	  			</template>  
			</ol>  
		</div>  
	</div>  
</div>

</template>

<style scoped>
	.grid-layout {
		padding: 1rem;
		display: grid;
		grid-template-columns: 1fr;
		gap: 1.5rem;
		max-width: 1600px;
		margin: 0 auto;
	}

	@media (min-width: 768px) {
		.grid-layout {
			grid-template-columns: 1fr 1.5fr;
		}
	}

	@media (min-width: 1200px) {
		.grid-layout {
			grid-template-columns: 1fr 2fr 1fr;
			gap: 2rem;
		}
	}

	.chessboard {
		position: relative;
		width: 100%;
		max-width: 600px;
		margin: 0 auto;
	}

	.board-area {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		align-items: center;
	}

	@media (min-width: 768px) {
		.board-area {
			flex-direction: row;
			gap: 0.5rem;
			justify-content: center;
			align-items: flex-start;
		}
	}

	:deep(.cg-wrap) {
		overflow: hidden;
		border-radius: 18px;
		width: 100%;
		aspect-ratio: 1;
		max-width: min(90vw, 35rem);
		height: auto;
		box-shadow: 0 15px 40px rgba(0, 0, 0, 0.4);
		border-radius: 8px;
	}

	.moves {
		margin-top: 10px;
		background: linear-gradient(145deg, #8b5a32, #6d4524);
		border-radius: 16px;
		width: 100%;
		max-width: 500px;
		height: clamp(300px, 50vh, 500px);
		box-shadow: 0 15px 35px rgba(0, 0, 0, 0.45), inset 0 1px 0 rgba(255, 255, 255, 0.1);
		list-style-position: inside;
		overflow-y: auto;
		overflow-x: hidden;
		box-sizing: border-box;
		border: 1px solid rgba(255, 255, 255, 0.08);
		margin: 0 auto;
	}

	@media (min-width: 1200px) {
		.moves {
			max-width: 20rem;
		}
	}

	.moves::-webkit-scrollbar {
		width: 8px;
	}

	.moves::-webkit-scrollbar-track {
		background: rgba(0, 0, 0, 0.2);
		border-radius: 10px;
	}

	.moves::-webkit-scrollbar-thumb {
		background: rgba(194, 197, 170, 0.4);
		border-radius: 10px;
	}

	.moves::-webkit-scrollbar-thumb:hover {
		background: rgba(194, 197, 170, 0.6);
	}

	.analyze {
		margin-top: -7px;
		border-radius: 15px;
		width: 100%;
		max-width: 500px;
		min-height: 250px;
		height: auto;
		padding-bottom: 1rem;
		background: linear-gradient(145deg, #8b5a32, #6d4524);
		box-sizing: border-box;
		box-shadow: 0 15px 35px rgba(0, 0, 0, 0.45), inset 0 1px 0 rgba(255, 255, 255, 0.1);
		border: 1px solid rgba(255, 255, 255, 0.08);
		margin: auto;
		margin-bottom: 1.5rem;
	}

	@media (min-width: 1200px) {
		.analyze {
			max-width: 20rem;
		}
	}

	.analyzis {
		color: #f5f5dc;
		text-align: center;
		font-weight: 600;
		text-shadow: 1px 1px 2px rgba(0, 0, 0, 0.3);
		letter-spacing: 0.5px;
		font-size: clamp(1.2rem, 3vw, 1.5rem);
	}

	.movehistory {
		position: sticky;
		text-align: center;
		color: #f5f5dc;
		font-weight: 600;
		margin: 12px 0;
		text-shadow: 1px 1px 2px rgba(0, 0, 0, 0.3);
		letter-spacing: 0.5px;
		font-size: clamp(1.2rem, 3vw, 1.5rem);
	}

	.moveslist {
		margin: 0 auto;
		padding: 10px;
		width: 90%;
		background: linear-gradient(135deg, #a57548, #7d5530);
		border-radius: 14px;
		list-style: none;
		font-size: clamp(0.9rem, 2vw, 1rem);
		box-shadow: inset 0 2px 6px rgba(0, 0, 0, 0.25);
	}

	.list {
		display: grid;
		grid-template-columns: 1fr 1fr 1fr 1fr;
		position: relative;
		justify-content: space-between;
		align-items: center;
		padding: 8px 40px 8px 14px;
		margin-bottom: 6px;
		border-radius: 10px;
		color: #e8e8d0;
		background: linear-gradient(135deg, rgba(255, 255, 255, 0.05), rgba(255, 255, 255, 0.02));
		border: 1px solid rgba(194, 197, 170, 0.3);
		transition: all 0.2s ease;
		font-weight: 500;
		box-shadow: 0 2px 4px rgba(0, 0, 0, 0.15);
	}

	.movespan {
		color: #b8c5ff;
		font-weight: 500;
		padding-left: 40px;
		position: relative;
	}

	.list:hover {
		background: linear-gradient(135deg, rgba(103, 122, 228, 0.25), rgba(103, 122, 228, 0.15));
		border-color: rgba(184, 197, 255, 0.5);
		transform: translateX(2px);
		box-shadow: 0 3px 8px rgba(0, 0, 0, 0.25);
	}

	.boardtools {
		display: flex;
		gap: 1rem;
		justify-content: center;
		align-items: center;
		height: auto;
		min-height: 3.2rem;
		width: 100%;
		max-width: 600px;
		background: linear-gradient(145deg, #8b5a32, #6d4524);
		border: 2px solid rgba(182, 173, 144, 0.4);
		padding: 0.5rem 1rem;
		border-radius: 10px;
		transition: all 0.2s ease;
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
		margin: 0 auto;
		flex-wrap: wrap;
	}

	.reverse,
	.undo,
	.reset {
		background-color: #9d6639;
		width: clamp(35px, 8vw, 40px);
		height: clamp(35px, 8vw, 40px);
		border: none;
		border-radius: 15px;
		font-size: clamp(16px, 4vw, 20px);
		color: #e8e8d0;
		cursor: pointer;
		transition: all 0.2s ease;
		flex-shrink: 0;
	}

	.reversetip,
	.undotip,
	.resettip {
		display: none;
	}

	@media (min-width: 768px) {
		.reversetip,
		.undotip,
		.resettip {
			display: block;
			opacity: 0;
			position: absolute;
			font-size: clamp(14px, 2vw, 17px);
			padding: 0.5rem;
			border-radius: 10px;
			text-align: center;
			background-color: #242424;
			pointer-events: none;
			white-space: nowrap;
		}

		.reversetip {
			margin-top: -4.5rem;
			transform: translateX(-50%);
			left: 50%;
		}

		.undotip {
			margin-top: -4.5rem;
			transform: translateX(-50%);
			left: 50%;
		}

		.resettip {
			margin-top: -4.5rem;
			transform: translateX(-50%);
			left: 50%;
		}
	}

	.reverse:hover,
	.undo:hover,
	.reset:hover {
		background: linear-gradient(145deg, #9d6640, #7d5530);
		border-color: rgba(232, 232, 208, 0.6);
		box-shadow: 0 6px 16px rgba(0, 0, 0, 0.4);
	}

	@media (min-width: 768px) {
		.reverse:hover + .reversetip,
		.undo:hover + .undotip,
		.reset:hover + .resettip {
			animation-name: fadeIn;
			animation-duration: 0.4s;
			animation-fill-mode: forwards;
			animation-delay: 0.3s;
		}
	}

	.reverse:active,
	.undo:active,
	.reset:active {
		transform: translateY(2px);
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
	}

	@keyframes fadeIn {
		from {
			opacity: 0;
		}
		to {
			opacity: 0.8;
		}
	}

	.list.active {
		background: linear-gradient(135deg, rgba(103, 122, 228, 0.35), rgba(103, 122, 228, 0.15));
		border-color: rgba(184, 197, 255, 0.8);
		box-shadow: 0 4px 12px rgba(103, 122, 228, 0.4);
	}

	.evalbar {
		width: 90%;
		max-width: min(90vw, 35rem);
		height: clamp(30px, 5vw, 40px);
		max-height: 40px;
		display: flex;
		flex-direction: row;
		position: relative;
		border-radius: 10px;
		overflow: hidden;
	}

	@media (min-width: 768px) {
		.evalbar {
			width: clamp(30px, 5vw, 40px);
			height: 100%;
			max-height: min(95vw, 36.5rem);
			flex-direction: column;
			flex-shrink: 0;
		}
	}

	.blackeval,
	.whiteeval {
		width: 100%;
		transition: all 0.5s ease;
		position: relative;
	}

	.blackeval {
		background-color: #38412e;
		border-radius: 10px 10px 0 0;
	}

	@media (max-width: 767px) {
		.blackeval {
			border-radius: 10px 0 0 10px;
		}
	}

	.whiteeval {
		background-color: #626949;
		border-radius: 0 0 10px 10px;
	}

	@media (max-width: 767px) {
		.whiteeval {
			border-radius: 0 10px 10px 0;
		}
	}

	.evalnum {
		position: absolute;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
		font-size: clamp(0.9rem, 2vw, 1.1rem);
		font-weight: 700;
		color: #fff8ef;
		text-shadow: 1px 1px 3px rgba(0, 0, 0, 0.6);
		background: rgba(0, 0, 0, 0.3);
		padding: 0.25rem 0.5rem;
		border-radius: 6px;
		text-align: center;
		backdrop-filter: blur(4px);
		white-space: nowrap;
		z-index: 10;
	}

	.accuracyemojiW,
	.accuracyemojiB {
		position: absolute;
		width: clamp(18px, 3vw, 22px);
		height: clamp(18px, 3vw, 22px);
		border-radius: 50%;
		display: flex;
		align-items: center;
		justify-content: center;
		font-weight: bold;
		font-size: clamp(11px, 2vw, 14px);
		color: white;
		top: 50%;
		transform: translateY(-50%);
	}

	.accuracyemojiW {
		position: relative;
	}

	.accuracyemojiB {
		left: 8px;
	}

	.accuracyemojiW.best,
	.accuracyemojiB.best {
		background: #3fa34d;
	}

	.accuracyemojiW.excellent,
	.accuracyemojiB.excellent {
		background: #88b65c;
	}

	.accuracyemojiW.good,
	.accuracyemojiB.good {
		background: darkgreen;
	}

	.accuracyemojiW.inaccuracy,
	.accuracyemojiB.inaccuracy {
		background: #f0c36d;
	}

	.accuracyemojiW.mistake,
	.accuracyemojiB.mistake {
		background: #e67e22;
	}

	.accuracyemojiW.blunder,
	.accuracyemojiB.blunder {
		background: #e74c3c;
	}

	.accuracyemojiW.great,
	.accuracyemojiB.great {
		background: darkcyan;
	}

	.accuracyemojiW.book,
	.accuracyemojiB.book {
		background: #aa8b6c;
	}

	.accuracyemojiW.brilliant,
	.accuracyemojiB.brilliant {
		background: lightblue;
	}

	.accuracydescribtion {
		text-align: center;
		font-size: clamp(1.1rem, 3vw, 1.5rem);
		margin-top: 1rem;
		padding: 0 1rem;
		word-wrap: break-word;
	}

	.bestmove {
		color: #41a24e;
		text-align: center;
		margin-top: 0.5rem;
		font-size: clamp(0.9rem, 2vw, 1rem);
		padding: 0 1rem;
	}

	.movedata {
		padding: 0 1rem;
	}

	.depthnum {
		text-align: center;
		color: #f5f5dc;
		font-size: clamp(0.9rem, 2vw, 1rem);
		margin: 0.5rem 0;
	}

	.line {
		font-family: "JetBrains Mono", monospace;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		font-size: clamp(0.85rem, 2vw, 1rem);
		min-height: 40px;
		padding: 0.5rem;
		margin: 8px 0;
		background: rgba(0, 0, 0, 0.25);
		border-radius: 10px;
		color: #eae4d8;
		box-shadow: inset 0 1px 4px rgba(0, 0, 0, 0.4);
		word-break: break-word;
	}

	.evalnum2 {
		font-size: clamp(1.1rem, 2.5vw, 1.5rem);
		font-weight: 700;
		color: #fff4e6;
		text-shadow: 0 2px 6px rgba(0, 0, 0, 0.5);
		order: 2;
		flex-shrink: 0;
	}

	.secondline {
		font-family: "JetBrains Mono", monospace;
		font-size: clamp(0.8rem, 2vw, 0.95rem);
		padding: 8px;
		margin-top: 6px;
		background: rgba(0, 0, 0, 0.15);
		border-radius: 8px;
		color: #cfc6b8;
		opacity: 0.85;
		word-break: break-word;
	}

	@keyframes fadeSlide {
		from {
			opacity: 0;
			transform: translateY(6px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	.movespan{
		position: absolute;
		left: 160px;
	}
</style>