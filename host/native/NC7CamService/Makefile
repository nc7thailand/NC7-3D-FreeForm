CXX ?= c++
CXXFLAGS ?= -std=c++17 -O2 -Wall -Wextra -Wpedantic
SRC := src/main.cpp src/cam_service.cpp

ifeq ($(OS),Windows_NT)
  EXE := .exe
else
  EXE :=
endif

OUT := build/nc7-cam-service$(EXE)

.PHONY: all clean

all: $(OUT)

$(OUT): $(SRC) src/cam_service.hpp src/json_mini.hpp src/base64.hpp
	mkdir -p build
	$(CXX) $(CXXFLAGS) -o $(OUT) $(SRC)

clean:
	rm -rf build
