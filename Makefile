PYTHON_CMD := python3

setup:
	${PYTHON_CMD} -m venv internal/venv
	(\
	source internal/venv/bin/activate ;\
	pip install legacy-cgi\
	)

clean:
	rm -rf internal/venv

run:
	(\
	source internal/venv/bin/activate ;\
	python internal/server.py\
	)
