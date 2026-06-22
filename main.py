from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from stockfish import Stockfish
import chess
import chess.engine
import chess.polyglot
from fastapi.middleware.cors import CORSMiddleware
from queue import Queue
from contextlib import contextmanager



app=FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class FENRequests (BaseModel):
	move: str
	moves_list: list[str] = Field(default_factory=list)
	depth: int=10

class MOVERequests (BaseModel):
	move: str
	color: str	
	moves_list: list[str] = Field(default_factory=list)
	elo: int=1000


book_path = "Performance.bin"



engine_pool = Queue()
chess_engine_pool = Queue()

for _ in range(2):
    engine_pool.put(Stockfish(path="/usr/bin/stockfish"))
    chess_engine_pool.put(chess.engine.SimpleEngine.popen_uci("/usr/bin/stockfish"))

@contextmanager
def get_engine():
    engine = engine_pool.get()
    try:
        yield engine
    finally:
        engine_pool.put(engine)

@contextmanager
def get_chess_engine():
    engine = chess_engine_pool.get()
    try:
        yield engine
    finally:
        chess_engine_pool.put(engine)

book_reader = chess.polyglot.open_reader(book_path)

#----------------------------evaluation function-----------------------
def get_evaluation (request: FENRequests):
	with get_engine() as stockfish:	
		stockfish.set_position(request.moves_list)
		stockfish.set_depth(request.depth)
		brilliant_loss = 0
		eval_before=stockfish.get_evaluation()
		top_moves = stockfish.get_top_moves(2)
	#determining book moves
		board=chess.Board()
		for move in request.moves_list:
			board.push_uci(move)
		book_moves = [entry.move for entry in book_reader.find_all(board)]
	#determining second best move
		if len(top_moves) ==2:
			second_best_eval = top_moves[1]["Centipawn"]
			second_best_eval=top_moves[0]["Centipawn"]
		best_move=top_moves[0]["Move"]
		move_played=request.move
		request.moves_list.append(move_played)
		if move_played:
			board.push_uci(move_played)
		stockfish.set_position(request.moves_list)
		eval_after=stockfish.get_evaluation()
	#determining whose move it is
		side_to_move="w" if len(request.moves_list)%2 == 1 else "b"

	#calculating the loss of the eval after the move
		if eval_before["type"] != "cp" or eval_after["type"] != "cp":
			loss=0
		else:		
			if side_to_move == "w":
				loss=eval_before["value"]-eval_after["value"]
				brilliant_loss = eval_before["value"]-second_best_eval
			elif side_to_move =="b": 
				loss=eval_after["value"]-eval_before["value"]
				brilliant_loss = second_best_eval-eval_before["value"]
			loss=max(loss, 0)

	#determining accuracy of a played move
		accuracy ="none"
		if (request.move):
			if chess.Move.from_uci(move_played) in book_moves:
				accuracy = "book"
			elif best_move == move_played and len(top_moves)==2 and brilliant_loss > 150:
				accuracy = "great"
			elif   -1 <= loss <15:
				accuracy = "best"
			elif 15 <= loss <40:
				accuracy="excellent"
			elif 40 <= loss <80:
				accuracy="good"
			elif 80 <= loss <150:
				accuracy="inaccuracy"
			elif 150 <= loss <300:
				accuracy="mistake"
			elif 300 <= loss:
				accuracy="blunder"

	#making accuracy compatible for mates
		if eval_before ["type"]=="cp" and eval_after ["type"]=="mate":
			if side_to_move == "w":
				if eval_before ["value"]>-500:
					accuracy = "blunder"
				else:
				    accuracy = "mistake"
			elif side_to_move == "b":
				if eval_before ["value"]<500:
					accuracy = "blunder"
				else:
					accuracy="mistake"

	#getting lines
	def get_lines():
	    with get_chess_engine() as engine:
	        lines = engine.analyse(board, chess.engine.Limit(depth=request.depth), multipv=2)
	    best_line = [move.uci() for move in lines[0].get("pv", [])]
	    excellent_line = [move.uci() for move in lines[1].get("pv", [])] if len(lines) > 1 else []
	    return best_line, excellent_line
	best_line, excellent_line = get_lines()


	return{
	"depth": request.depth,
	"move_played": move_played,
	"best_move": best_move,
	"eval": eval_after,
	"excellent_eval": top_moves[1]["Centipawn"] if len(top_moves) > 1 else None,
	"move_accuracy": accuracy,
	"best_line": best_line,
	"excellent_line": excellent_line,
	"moves_list": request.moves_list
	}


def play_computer(request: MOVERequests):
	with get_engine() as stockfish:		
		stockfish.set_elo_rating(request.elo)
		user_move=request.move
		stockfish.set_position(request.moves_list)
		if request.color == "white":
			correct_move=stockfish.is_move_correct(user_move)
			if correct_move:
				request.moves_list.append(user_move)
				stockfish.set_position(request.moves_list)
				stockfish_response=stockfish.get_best_move()
				request.moves_list.append(stockfish_response)
				stockfish.set_position(request.moves_list)
			else:
				raise HTTPException(status_code=400, detail="illegal move!")
		elif request.color == "black":
			stockfish_response=stockfish.get_best_move()
			request.moves_list.append(stockfish_response)
			correct_move=stockfish.is_move_correct(user_move)
			if correct_move:
				request.moves_list.append(user_move)
				stockfish.set_position(request.moves_list)
			else:
				raise HTTPException(status_code=400, detail="illegal move!")
			stockfish.set_position(request.moves_list)

		return{
		"moves_list": request.moves_list,
		"stockfish_rating": request.elo,
		"user_playing_with": request.color,
		"user_move": user_move,
		"stockfish_move": stockfish_response
		}


#-------------------------------endpoints----------------------

@app.get("/home")
def home():
	return{"message": "home"}

@app.post("/Analyzis")
def get_eval(request: FENRequests):
	return get_evaluation(request)

@app.post("/vsComputer")
def vsComputer(request: MOVERequests):
	return play_computer(request)

