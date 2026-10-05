export const WASM_OJ_PCH_PATH = "wasm-oj.pch.hpp";

export const CPP_STANDARD_HEADER_INCLUDES = `#include <any>
#include <atomic>
#include <bit>
#include <cfenv>
#include <cinttypes>
#include <clocale>
#include <codecvt>
#include <complex>
#include <cstdarg>
#include <ctime>
#include <cuchar>
#include <cwchar>
#include <cwctype>
#include <filesystem>
#include <format>
#include <forward_list>
#include <fstream>
#include <initializer_list>
#include <istream>
#include <list>
#include <locale>
#include <memory_resource>
#include <new>
#include <numbers>
#include <ostream>
#include <ratio>
#include <regex>
#include <scoped_allocator>
#include <source_location>
#include <stdexcept>
#include <streambuf>
#include <system_error>
#include <typeindex>
#include <typeinfo>
#include <valarray>
#include <version>
`;

export function cppStandardHeader(pchHeader: string): string {
  return `${pchHeader}\n${CPP_STANDARD_HEADER_INCLUDES}`;
}
