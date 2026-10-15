-- JSON encoder for small measurement reports; no executable data or decoder.
local M = {}
function M.encode(value)
  local kind = type(value)
  if kind == 'nil' then return 'null' end
  if kind == 'boolean' then return tostring(value) end
  if kind == 'number' then
    assert(value == value and math.abs(value) ~= math.huge, 'Non-finite JSON number')
    return string.format('%.14g', value)
  end
  if kind == 'string' then
    return '"' .. value:gsub('[%z\1-\31\\"]', function(c) return string.format('\\u%04x', string.byte(c)) end) .. '"'
  end
  assert(kind == 'table', 'Unsupported JSON value')
  local fields = {}
  for key, entry in pairs(value) do fields[#fields+1] = M.encode(tostring(key)) .. ':' .. M.encode(entry) end
  table.sort(fields)
  return '{' .. table.concat(fields, ',') .. '}'
end
return M
