#pragma once

#include <cctype>
#include <cmath>
#include <cstdio>
#include <iomanip>
#include <locale>
#include <sstream>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

namespace nc7 {

class Json {
 public:
  enum class Type { Null, Bool, Number, String, Array, Object };

  Type type = Type::Null;
  bool b = false;
  double n = 0;
  std::string s;
  std::vector<Json> a;
  std::vector<std::pair<std::string, Json>> o;

  static Json nul() {
    Json j;
    j.type = Type::Null;
    return j;
  }

  static Json boolean(bool value) {
    Json j;
    j.type = Type::Bool;
    j.b = value;
    return j;
  }

  static Json number(double value) {
    Json j;
    j.type = Type::Number;
    j.n = value;
    return j;
  }

  static Json str(std::string value) {
    Json j;
    j.type = Type::String;
    j.s = std::move(value);
    return j;
  }

  static Json array(std::vector<Json> value = {}) {
    Json j;
    j.type = Type::Array;
    j.a = std::move(value);
    return j;
  }

  static Json object(std::vector<std::pair<std::string, Json>> value = {}) {
    Json j;
    j.type = Type::Object;
    j.o = std::move(value);
    return j;
  }

  bool isNull() const { return type == Type::Null; }
  bool isBool() const { return type == Type::Bool; }
  bool isNumber() const { return type == Type::Number; }
  bool isString() const { return type == Type::String; }
  bool isArray() const { return type == Type::Array; }
  bool isObject() const { return type == Type::Object; }

  const Json* find(const std::string& key) const {
    if (type != Type::Object) return nullptr;
    for (const auto& field : o) {
      if (field.first == key) return &field.second;
    }
    return nullptr;
  }
};

inline Json obj(std::initializer_list<std::pair<const char*, Json>> fields) {
  std::vector<std::pair<std::string, Json>> out;
  out.reserve(fields.size());
  for (const auto& field : fields) out.emplace_back(field.first, field.second);
  return Json::object(std::move(out));
}

class JsonParser {
 public:
  explicit JsonParser(const std::string& text) : text_(text) {}

  Json parse() {
    skip();
    Json value = parseValue();
    skip();
    if (i_ != text_.size()) throw std::runtime_error("trailing data in JSON");
    return value;
  }

 private:
  const std::string& text_;
  std::size_t i_ = 0;
  int depth_ = 0;

  void skip() {
    while (i_ < text_.size() && std::isspace(static_cast<unsigned char>(text_[i_]))) ++i_;
  }

  char peek() const {
    if (i_ >= text_.size()) throw std::runtime_error("unexpected end of JSON");
    return text_[i_];
  }

  char get() {
    const char c = peek();
    ++i_;
    return c;
  }

  Json parseValue() {
    if (++depth_ > 64) throw std::runtime_error("JSON nesting limit");
    skip();
    const char c = peek();
    Json value;
    if (c == 'n') value = parseLiteral("null", Json::nul());
    else if (c == 't') value = parseLiteral("true", Json::boolean(true));
    else if (c == 'f') value = parseLiteral("false", Json::boolean(false));
    else if (c == '"') value = Json::str(parseString());
    else if (c == '[') value = parseArray();
    else if (c == '{') value = parseObject();
    else if (c == '-' || std::isdigit(static_cast<unsigned char>(c))) value = parseNumber();
    else throw std::runtime_error(std::string("invalid JSON value"));
    --depth_;
    return value;
  }

  Json parseLiteral(const char* literal, Json value) {
    for (const char* p = literal; *p; ++p) {
      if (get() != *p) throw std::runtime_error("invalid JSON literal");
    }
    return value;
  }

  static void appendUtf8(std::string& out, int code) {
    if (code < 0x80) {
      out.push_back(static_cast<char>(code));
    } else if (code < 0x800) {
      out.push_back(static_cast<char>(0xC0 | (code >> 6)));
      out.push_back(static_cast<char>(0x80 | (code & 0x3F)));
    } else {
      out.push_back(static_cast<char>(0xE0 | (code >> 12)));
      out.push_back(static_cast<char>(0x80 | ((code >> 6) & 0x3F)));
      out.push_back(static_cast<char>(0x80 | (code & 0x3F)));
    }
  }

  std::string parseString() {
    if (get() != '"') throw std::runtime_error("expected string");
    std::string out;
    while (true) {
      if (i_ >= text_.size()) throw std::runtime_error("unterminated string");
      const char c = get();
      if (c == '"') break;
      if (static_cast<unsigned char>(c) < 0x20) {
        throw std::runtime_error("raw control character in string");
      }
      if (c != '\\') {
        out.push_back(c);
        continue;
      }
      const char escaped = get();
      switch (escaped) {
        case '"':
        case '\\':
        case '/':
          out.push_back(escaped);
          break;
        case 'b':
          out.push_back('\b');
          break;
        case 'f':
          out.push_back('\f');
          break;
        case 'n':
          out.push_back('\n');
          break;
        case 'r':
          out.push_back('\r');
          break;
        case 't':
          out.push_back('\t');
          break;
        case 'u': {
          int code = 0;
          for (int k = 0; k < 4; ++k) {
            const char hex = get();
            code <<= 4;
            if (hex >= '0' && hex <= '9') code += hex - '0';
            else if (hex >= 'a' && hex <= 'f') code += hex - 'a' + 10;
            else if (hex >= 'A' && hex <= 'F') code += hex - 'A' + 10;
            else throw std::runtime_error("invalid hex escape");
          }
          appendUtf8(out, code);
          break;
        }
        default:
          throw std::runtime_error("invalid escape");
      }
    }
    return out;
  }

  Json parseNumber() {
    const std::size_t start = i_;
    if (peek() == '-') get();
    if (i_ >= text_.size() || !std::isdigit(static_cast<unsigned char>(peek()))) {
      throw std::runtime_error("invalid number");
    }
    if (peek() == '0') {
      get();
    } else {
      while (i_ < text_.size() && std::isdigit(static_cast<unsigned char>(text_[i_]))) ++i_;
    }
    if (i_ < text_.size() && text_[i_] == '.') {
      ++i_;
      if (i_ >= text_.size() || !std::isdigit(static_cast<unsigned char>(text_[i_]))) {
        throw std::runtime_error("invalid fraction");
      }
      while (i_ < text_.size() && std::isdigit(static_cast<unsigned char>(text_[i_]))) ++i_;
    }
    if (i_ < text_.size() && (text_[i_] == 'e' || text_[i_] == 'E')) {
      ++i_;
      if (i_ < text_.size() && (text_[i_] == '+' || text_[i_] == '-')) ++i_;
      if (i_ >= text_.size() || !std::isdigit(static_cast<unsigned char>(text_[i_]))) {
        throw std::runtime_error("invalid exponent");
      }
      while (i_ < text_.size() && std::isdigit(static_cast<unsigned char>(text_[i_]))) ++i_;
    }
    const std::string token = text_.substr(start, i_ - start);
    try {
      std::size_t used = 0;
      const double value = std::stod(token, &used);
      if (used != token.size() || !std::isfinite(value)) throw std::runtime_error("invalid number");
      return Json::number(value);
    } catch (const std::runtime_error&) {
      throw;
    } catch (...) {
      throw std::runtime_error("invalid number");
    }
  }

  Json parseArray() {
    if (get() != '[') throw std::runtime_error("expected array");
    std::vector<Json> items;
    skip();
    if (peek() == ']') {
      get();
      return Json::array(std::move(items));
    }
    while (true) {
      items.push_back(parseValue());
      skip();
      const char c = get();
      if (c == ']') break;
      if (c != ',') throw std::runtime_error("expected comma in array");
    }
    return Json::array(std::move(items));
  }

  Json parseObject() {
    if (get() != '{') throw std::runtime_error("expected object");
    std::vector<std::pair<std::string, Json>> fields;
    skip();
    if (peek() == '}') {
      get();
      return Json::object(std::move(fields));
    }
    while (true) {
      skip();
      if (peek() != '"') throw std::runtime_error("expected object key");
      std::string key = parseString();
      skip();
      if (get() != ':') throw std::runtime_error("expected colon");
      fields.emplace_back(std::move(key), parseValue());
      skip();
      const char c = get();
      if (c == '}') break;
      if (c != ',') throw std::runtime_error("expected comma in object");
    }
    return Json::object(std::move(fields));
  }
};

inline Json parseJson(const std::string& text) { return JsonParser(text).parse(); }

inline void appendEscaped(std::string& out, const std::string& value) {
  out.push_back('"');
  for (unsigned char c : value) {
    switch (c) {
      case '"':
        out += "\\\"";
        break;
      case '\\':
        out += "\\\\";
        break;
      case '\b':
        out += "\\b";
        break;
      case '\f':
        out += "\\f";
        break;
      case '\n':
        out += "\\n";
        break;
      case '\r':
        out += "\\r";
        break;
      case '\t':
        out += "\\t";
        break;
      default:
        if (c < 0x20) {
          char buf[8];
          std::snprintf(buf, sizeof(buf), "\\u%04x", c);
          out += buf;
        } else {
          out.push_back(static_cast<char>(c));
        }
    }
  }
  out.push_back('"');
}

inline void appendJson(std::string& out, const Json& value) {
  switch (value.type) {
    case Json::Type::Null:
      out += "null";
      break;
    case Json::Type::Bool:
      out += value.b ? "true" : "false";
      break;
    case Json::Type::Number: {
      if (!std::isfinite(value.n)) throw std::runtime_error("non-finite JSON number");
      double integral = 0;
      if (std::modf(value.n, &integral) == 0.0 && std::abs(value.n) < 1e15) {
        out += std::to_string(static_cast<long long>(value.n));
      } else {
        std::ostringstream oss;
        oss.imbue(std::locale::classic());
        oss.setf(std::ios::fmtflags(0), std::ios::floatfield);
        oss << std::setprecision(16) << value.n;
        out += oss.str();
      }
      break;
    }
    case Json::Type::String:
      appendEscaped(out, value.s);
      break;
    case Json::Type::Array:
      out.push_back('[');
      for (std::size_t i = 0; i < value.a.size(); ++i) {
        if (i) out.push_back(',');
        appendJson(out, value.a[i]);
      }
      out.push_back(']');
      break;
    case Json::Type::Object:
      out.push_back('{');
      for (std::size_t i = 0; i < value.o.size(); ++i) {
        if (i) out.push_back(',');
        appendEscaped(out, value.o[i].first);
        out.push_back(':');
        appendJson(out, value.o[i].second);
      }
      out.push_back('}');
      break;
  }
}

inline std::string stringifyJson(const Json& value) {
  std::string out;
  out.reserve(256);
  appendJson(out, value);
  return out;
}

}  // namespace nc7
